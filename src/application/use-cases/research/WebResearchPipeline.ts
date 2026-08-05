import { formatCitation } from "@core/retrieval";
import { SearchProvider, SearchProviderResult, WebSearchOptions } from "@application/ports/web";
import { WebContextDiagnostics } from "@core/diagnostics";
import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import { tokenSetForSearch } from "@core/retrieval";
import { normalizeInlineWhitespace } from "@shared";
import { estimateTextTokens } from "@core/research";
import { ResearchStreamEvent } from "@application/contracts/research";

export interface ResearchEvidenceResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  diagnostics?: WebContextDiagnostics;
}

export interface WebSearchPipelineOptions {
  evidenceLimit?: number;
}

export interface WebResearchPipelineOptions {
  searchProvider?: SearchProvider;
  evidenceLimit: number;
}

const NORMAL_WEB_SEARCH_OPTIONS: Required<Pick<WebSearchOptions, "limit" | "maxFetches">> = {
  limit: 5,
  maxFetches: 3,
};

export class WebResearchPipeline {
  private readonly searchProvider?: SearchProvider;
  private readonly evidenceLimit: number;

  constructor(options: WebResearchPipelineOptions) {
    this.searchProvider = options.searchProvider;
    this.evidenceLimit = options.evidenceLimit;
  }

  async *search(
    question: string,
    includeWebSearch: boolean,
    options: WebSearchPipelineOptions = {},
  ): AsyncGenerator<ResearchStreamEvent, ResearchEvidenceResult> {
    if (!includeWebSearch || !this.searchProvider) {
      return { chunks: [], citations: [] };
    }

    const evidenceLimit = options.evidenceLimit ?? this.evidenceLimit;

    const queries = [question];

    yield { type: "status", message: "Searching web..." };
    const search = {
      results: await this.searchProvider.search(question, NORMAL_WEB_SEARCH_OPTIONS),
      requests: [{ query: question, ...NORMAL_WEB_SEARCH_OPTIONS }],
    };
    const results = search.results;

    if (results.length === 0) {
      return {
        chunks: [],
        citations: [],
        diagnostics: createWebDiagnostics(question, "direct", queries, search.requests, [], []),
      };
    }

    yield { type: "status", message: "Fetching sources..." };
    const rankedResults = rankWebResults(dedupeWebResults(results), question);
    const selectedResults = rankedResults.slice(0, evidenceLimit);
    const chunks = selectedResults.map((result) => webResultToChunk(result));

    return {
      chunks,
      citations: chunks.map((chunk) => ({ ...formatCitation(chunk.source), id: chunk.id })),
      diagnostics: createWebDiagnostics(
        question,
        "direct",
        queries,
        search.requests,
        results,
        rankedResults,
        evidenceLimit,
      ),
    };
  }
}

function createWebDiagnostics(
  originalQuestion: string,
  queryStrategy: WebContextDiagnostics["queryStrategy"],
  queries: string[],
  requests: WebContextDiagnostics["requests"],
  rawResults: SearchProviderResult[],
  rankedResults: SearchProviderResult[],
  evidenceLimit = 0,
): WebContextDiagnostics {
  const processingRanks = new Map(
    rankedResults.map((result, index) => [result, index + 1] as const),
  );
  const retainedResults = new Set(rankedResults);

  return {
    originalQuestion,
    queryStrategy,
    queries,
    requests,
    results: rawResults.map((result) => {
      const text = result.extractedText ?? result.source.snippet;
      const processingRank = processingRanks.get(result);
      const isDuplicate = !retainedResults.has(result);
      const exceedsLimit = processingRank !== undefined && processingRank > evidenceLimit;

      return {
        chunkId: result.source.id,
        query: result.query,
        url: result.source.url,
        title: result.source.title,
        providerRank: result.rank,
        ...(processingRank !== undefined ? { processingRank } : {}),
        relevanceScore: webResultScore(
          result,
          tokenSetForSearch(originalQuestion, { minLength: 3 }),
        ),
        wasContentFetched: result.source.wasContentFetched,
        textSource: result.extractedText !== undefined ? "fetched-content" : "search-snippet",
        textCharacters: text.length,
        estimatedTokens: estimateTextTokens(text),
        textPreview: normalizeInlineWhitespace(text).slice(0, 240),
        status: isDuplicate || exceedsLimit ? "dropped" : "candidate",
        ...(isDuplicate
          ? { reason: "duplicate-url" as const }
          : exceedsLimit
            ? { reason: "web-evidence-limit" as const }
            : {}),
      };
    }),
    finalPrompt: { includedChunkIds: [], usedTokens: 0 },
  };
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
