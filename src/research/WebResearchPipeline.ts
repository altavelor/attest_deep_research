import { formatCitation } from "../retrieval/citations";
import {
  ChatModelProvider,
  Citation,
  RetrievedChunk,
  SearchProvider,
  SearchProviderResult,
  WebSearchOptions,
} from "../shared/types";
import {
  collectChatText,
  parseLlmJsonObject,
  type LlmJsonParseDiagnostic,
} from "../shared/llmOutput";
import { tokenSetForSearch } from "../retrieval/tokenization";
import { normalizeInlineWhitespace } from "../shared/whitespace";
import { buildDeepResearchPlanPrompt } from "./prompts";
import { ResearchStreamEvent } from "./types";

export interface ResearchEvidenceResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
}

export interface WebResearchPipelineOptions {
  searchProvider?: SearchProvider;
  chatModel: ChatModelProvider;
  chatModelName: string;
  evidenceLimit: number;
  onDiagnostic?: (diagnostic: WebResearchDiagnostic) => void;
}

const NORMAL_WEB_SEARCH_OPTIONS: Required<Pick<WebSearchOptions, "limit" | "maxFetches">> = {
  limit: 5,
  maxFetches: 3,
};
const DEEP_WEB_QUERY_LIMIT = 4;
const DEEP_WEB_LIMIT_PER_QUERY = 5;
const DEEP_WEB_MAX_TOTAL_FETCHES = 8;
const HARD_MAX_DEEP_QUERIES = 10;
const HARD_MAX_TOTAL_RESULTS = 50;
const HARD_MAX_TOTAL_FETCHES = 15;
const MAX_QUERY_LENGTH = 240;
const MAX_LLM_OUTPUT_LENGTH = 20_000;

export interface WebResearchDiagnostic extends LlmJsonParseDiagnostic {
  source: "web-research-plan";
}

export class WebResearchPipeline {
  private readonly searchProvider?: SearchProvider;
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly evidenceLimit: number;
  private readonly onDiagnostic?: (diagnostic: WebResearchDiagnostic) => void;

  constructor(options: WebResearchPipelineOptions) {
    this.searchProvider = options.searchProvider;
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.evidenceLimit = options.evidenceLimit;
    this.onDiagnostic = options.onDiagnostic;
  }

  async *search(
    question: string,
    includeWebSearch: boolean,
    deepResearch: boolean,
  ): AsyncGenerator<ResearchStreamEvent, ResearchEvidenceResult> {
    if (!includeWebSearch || !this.searchProvider) {
      return { chunks: [], citations: [] };
    }

    const queries = deepResearch ? yield* this.buildDeepResearchQueries(question) : [question];

    yield { type: "status", message: "Searching web..." };
    const results = deepResearch
      ? await this.searchDeepWebResults(queries)
      : await this.searchProvider.search(question, NORMAL_WEB_SEARCH_OPTIONS);

    if (results.length === 0) {
      return { chunks: [], citations: [] };
    }

    yield { type: "status", message: "Fetching sources..." };
    const chunks = rankWebResults(dedupeWebResults(results), question)
      .slice(0, this.evidenceLimit)
      .map((result) => webResultToChunk(result));

    return {
      chunks,
      citations: chunks.map((chunk) => ({ ...formatCitation(chunk.source), id: chunk.id })),
    };
  }

  private async *buildDeepResearchQueries(
    question: string,
  ): AsyncGenerator<ResearchStreamEvent, string[]> {
    yield { type: "status", message: "Planning web queries..." };

    const planText = await collectChatText(
      this.chatModel.streamChat({
        model: this.chatModelName,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You plan web research queries. Return only compact JSON and never include private vault content.",
          },
          { role: "user", content: buildDeepResearchPlanPrompt(question, DEEP_WEB_QUERY_LIMIT) },
        ],
      }),
      { maxLength: MAX_LLM_OUTPUT_LENGTH },
    );
    const queries = parseDeepResearchQueries(planText, DEEP_WEB_QUERY_LIMIT, (diagnostic) =>
      this.onDiagnostic?.({ source: "web-research-plan", ...diagnostic }),
    );

    return queries.length > 0 ? queries : [question];
  }

  private async searchDeepWebResults(queries: string[]): Promise<SearchProviderResult[]> {
    const boundedQueries = queries.slice(0, HARD_MAX_DEEP_QUERIES);
    const results: SearchProviderResult[] = [];
    let remainingFetches = Math.min(DEEP_WEB_MAX_TOTAL_FETCHES, HARD_MAX_TOTAL_FETCHES);

    for (const query of boundedQueries) {
      if (results.length >= HARD_MAX_TOTAL_RESULTS) {
        break;
      }

      const perQueryMaxFetches = Math.min(DEEP_WEB_LIMIT_PER_QUERY, remainingFetches);
      const queryResults = await this.searchProvider?.search(query, {
        limit: DEEP_WEB_LIMIT_PER_QUERY,
        maxFetches: perQueryMaxFetches,
      });
      const nextResults = queryResults ?? [];
      results.push(...nextResults);
      remainingFetches -= nextResults.filter((result) => result.source.wasContentFetched).length;

      if (remainingFetches <= 0) {
        remainingFetches = 0;
      }
    }

    return results.slice(0, HARD_MAX_TOTAL_RESULTS);
  }
}

function parseDeepResearchQueries(
  value: string,
  maxQueries: number,
  onDiagnostic?: (diagnostic: LlmJsonParseDiagnostic) => void,
): string[] {
  const parsed = parseLlmJsonObject(value, {
    fallback: { queries: [] },
    maxInputLength: MAX_LLM_OUTPUT_LENGTH,
    validate: isQueriesObject,
    onDiagnostic,
  });

  return parsed.queries
    .filter((query): query is string => typeof query === "string")
    .map((query) => normalizeInlineWhitespace(query))
    .filter((query) => query.length > 0 && query.length <= MAX_QUERY_LENGTH)
    .slice(0, Math.min(maxQueries, HARD_MAX_DEEP_QUERIES));
}

function isQueriesObject(value: unknown): value is { queries: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { queries?: unknown }).queries)
  );
}

function dedupeWebResults(results: SearchProviderResult[]): SearchProviderResult[] {
  const byUrl = new Map<string, SearchProviderResult>();

  for (const result of results) {
    const key = normalizedWebResultUrl(result.source.url);
    const existing = byUrl.get(key);

    if (!existing || result.rank < existing.rank) {
      byUrl.set(key, result);
    }
  }

  return Array.from(byUrl.values());
}

function rankWebResults(results: SearchProviderResult[], question: string): SearchProviderResult[] {
  const queryTokens = tokenSetForSearch(question, { minLength: 3 });

  return [...results].sort((left, right) => {
    const scoreDelta = webResultScore(right, queryTokens) - webResultScore(left, queryTokens);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.rank - right.rank;
  });
}

function webResultScore(result: SearchProviderResult, queryTokens: Set<string>): number {
  const text = [result.source.title, result.source.snippet, result.extractedText ?? ""].join(" ");
  const resultTokens = tokenSetForSearch(text, { minLength: 3 });
  let overlap = 0;

  for (const token of queryTokens) {
    if (resultTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap * 10 + Math.max(0, 10 - result.rank);
}

function webResultToChunk(result: SearchProviderResult): RetrievedChunk {
  const text = result.extractedText ?? result.source.snippet;

  return {
    id: result.source.id,
    source: result.source,
    text,
    score: webResultScore(result, tokenSetForSearch(result.query, { minLength: 3 })),
    contentHash: `web:${result.source.url}`,
  };
}

function normalizedWebResultUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";

    for (const key of Array.from(url.searchParams.keys())) {
      if (key === "fbclid" || key === "gclid" || key.startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }

    return url.toString();
  } catch {
    return value;
  }
}
