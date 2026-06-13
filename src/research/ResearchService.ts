import { RetrievalResult } from "../retrieval/RetrievalService";
import { QueryExpansionService } from "../retrieval/QueryExpansionService";
import { formatCitation } from "../retrieval/citations";
import {
  ChatModelProvider,
  Citation,
  LanguageInventoryItem,
  ResearchAnswer,
  RetrievedChunk,
  RetrievalOptions,
  RetrievalQueryVariant,
  SearchProvider,
  SearchProviderResult,
  WebSearchOptions,
} from "../shared/types";
import {
  buildDeepResearchPlanPrompt,
  buildResearchPrompt,
  extractFollowUpQuestions,
} from "./prompts";

export interface ResearchRetriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievalResult>;
  getLanguageInventory?(): Promise<LanguageInventoryItem[]>;
}

export type ResearchSearchMode = "indexOnly" | "indexAndWeb" | "webOnly";

export interface ResearchRequest {
  question: string;
  includeWebSearch?: boolean;
  searchMode?: ResearchSearchMode;
  contextPaths?: string[];
  deepResearch?: boolean;
}

export type ResearchStreamEvent =
  | { type: "status"; message: string }
  | { type: "delta"; content: string }
  | { type: "complete"; answer: ResearchAnswer };

export interface ResearchServiceOptions {
  retriever: ResearchRetriever;
  chatModel: ChatModelProvider;
  chatModelName: string;
  searchProvider?: SearchProvider;
  queryExpansion?: QueryExpansionService;
  evidenceLimit?: number;
  temperature?: number;
  now?: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
}

const DEFAULT_EVIDENCE_LIMIT = 8;
const DEFAULT_TEMPERATURE = 0.2;
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

export class ResearchService {
  private readonly retriever: ResearchRetriever;
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly searchProvider?: SearchProvider;
  private readonly queryExpansion?: QueryExpansionService;
  private readonly evidenceLimit: number;
  private readonly temperature: number;
  private readonly now: () => Date;
  private readonly persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;

  constructor(options: ResearchServiceOptions) {
    this.retriever = options.retriever;
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.searchProvider = options.searchProvider;
    this.queryExpansion = options.queryExpansion;
    this.evidenceLimit = options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
    this.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    this.now = options.now ?? (() => new Date());
    this.persistFinalAnswer = options.persistFinalAnswer;
  }

  async *answer(request: ResearchRequest): AsyncIterable<ResearchStreamEvent> {
    const question = request.question.trim();
    const searchMode = resolveSearchMode(request);
    const deepResearch = request.deepResearch === true;
    const retrieval =
      searchMode === "webOnly"
        ? emptyRetrievalResult()
        : yield* this.searchVaultEvidence(question, request.contextPaths);
    const webEvidence = yield* this.searchWebEvidence(
      question,
      searchMode !== "indexOnly",
      deepResearch,
    );
    const evidence = mergeEvidenceChunks(
      retrieval.chunks,
      webEvidence.chunks,
      this.evidenceLimit,
      deepResearch,
    );
    const citations = mergeCitations(retrieval.citations, webEvidence.citations);
    const prompt = buildResearchPrompt({
      question,
      evidence,
      maxEvidenceItems: this.evidenceLimit,
    });
    let answerText = "";

    yield { type: "status", message: "Synthesizing answer..." };

    for await (const chunk of this.chatModel.streamChat({
      model: this.chatModelName,
      temperature: this.temperature,
      messages: [
        {
          role: "system",
          content:
            "You are Ixplorer, a local-first Obsidian research assistant. Answer only from provided evidence and preserve citation IDs.",
        },
        { role: "user", content: prompt },
      ],
    })) {
      if (chunk.content) {
        answerText += chunk.content;
        yield { type: "delta", content: chunk.content };
      }

      if (chunk.isComplete) {
        break;
      }
    }

    const finalAnswer: ResearchAnswer = {
      question,
      answer: answerText,
      citations,
      evidence,
      followUpQuestions: extractFollowUpQuestions(answerText),
      createdAt: this.now().toISOString(),
    };

    if (this.persistFinalAnswer) {
      await this.persistFinalAnswer(finalAnswer);
    }

    yield { type: "complete", answer: finalAnswer };
  }

  private async *searchVaultEvidence(
    question: string,
    contextPaths: string[] | undefined,
  ): AsyncGenerator<ResearchStreamEvent, RetrievalResult> {
    yield { type: "status", message: "Reading vault context..." };
    const queryVariants = yield* this.buildVaultQueryVariants(question);

    return this.retriever.search(question, {
      limit: this.evidenceLimit,
      includeWebResults: false,
      queryVariants,
      ...(contextPaths ? { sourcePaths: contextPaths } : {}),
    });
  }

  private async *buildVaultQueryVariants(
    question: string,
  ): AsyncGenerator<ResearchStreamEvent, RetrievalQueryVariant[] | undefined> {
    if (!this.queryExpansion || !this.retriever.getLanguageInventory) {
      return undefined;
    }

    const languageInventory = await this.retriever.getLanguageInventory();

    if (languageInventory.length === 0) {
      return undefined;
    }

    yield { type: "status", message: "Expanding search queries..." };
    const variants = await this.queryExpansion.buildVariants({
      query: question,
      languageInventory,
    });

    return variants.length > 0 ? variants : undefined;
  }

  private async *searchWebEvidence(
    question: string,
    includeWebSearch: boolean,
    deepResearch: boolean,
  ): AsyncGenerator<ResearchStreamEvent, { chunks: RetrievedChunk[]; citations: Citation[] }> {
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
    );
    const queries = parseDeepResearchQueries(planText, DEEP_WEB_QUERY_LIMIT);

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

function mergeCitations(primary: Citation[], secondary: Citation[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const citation of [...primary, ...secondary]) {
    if (!seen.has(citation.id)) {
      citations.push(citation);
      seen.add(citation.id);
    }
  }

  return citations;
}

function mergeEvidenceChunks(
  localChunks: RetrievedChunk[],
  webChunks: RetrievedChunk[],
  limit: number,
  preferWeb: boolean,
): RetrievedChunk[] {
  if (webChunks.length === 0) {
    return localChunks.slice(0, limit);
  }

  if (localChunks.length === 0) {
    return webChunks.slice(0, limit);
  }

  const webLimit = preferWeb
    ? Math.min(webChunks.length, Math.max(1, Math.ceil(limit / 2)))
    : Math.min(webChunks.length, Math.max(1, Math.floor(limit / 3)));
  const localLimit = Math.max(0, limit - webLimit);
  const primary = preferWeb ? webChunks.slice(0, webLimit) : localChunks.slice(0, localLimit);
  const secondary = preferWeb ? localChunks.slice(0, localLimit) : webChunks.slice(0, webLimit);

  return [...primary, ...secondary].slice(0, limit);
}

function resolveSearchMode(request: ResearchRequest): ResearchSearchMode {
  return request.searchMode ?? (request.includeWebSearch === true ? "indexAndWeb" : "indexOnly");
}

function emptyRetrievalResult(): RetrievalResult {
  return {
    chunks: [],
    citations: [],
    usedFallback: false,
  };
}

async function collectChatText(
  chunks: AsyncIterable<{ content: string; isComplete: boolean }>,
): Promise<string> {
  let text = "";

  for await (const chunk of chunks) {
    text += chunk.content;

    if (chunk.isComplete) {
      break;
    }
  }

  return text;
}

function parseDeepResearchQueries(value: string, maxQueries: number): string[] {
  const parsed = parseJsonObject(value);
  const queries = parsed?.queries;

  if (!Array.isArray(queries)) {
    return [];
  }

  return queries
    .filter((query): query is string => typeof query === "string")
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => query.length > 0 && query.length <= MAX_QUERY_LENGTH)
    .slice(0, Math.min(maxQueries, HARD_MAX_DEEP_QUERIES));
}

function parseJsonObject(value: string): { queries?: unknown } | null {
  const trimmed = value.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    return parsed && typeof parsed === "object" ? (parsed as { queries?: unknown }) : null;
  } catch {
    return null;
  }
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
  const queryTokens = tokenSet(question);

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
  const resultTokens = tokenSet(text);
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
    score: webResultScore(result, tokenSet(result.query)),
    contentHash: `web:${result.source.url}`,
  };
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
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
