import { formatCitation } from "@core/retrieval";
import { SearchProvider, SearchProviderResult, WebSearchOptions } from "@application/ports/web";
import { WebContextDiagnostics, WebResultExclusionReason } from "@core/diagnostics";
import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import { tokenSetForSearch } from "@core/retrieval";
import { normalizeInlineWhitespace } from "@shared";
import { estimateTextTokens } from "@core/research";
import type { ResearchModeWebParameters } from "@core/research";
import { assessWebTextQuality, canonicalizeWebEvidenceUrl, type WebSelectionMode } from "@core/web";
import type { WebSourceSelectionDiagnostics } from "@core/diagnostics";
import { ResearchStreamEvent } from "@application/contracts/research";

export interface ResearchEvidenceResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  diagnostics?: WebContextDiagnostics;
}

export interface WebSearchPipelineOptions {
  evidenceLimit?: number;
  signal?: AbortSignal;

  mode?: WebSelectionMode;

  web?: ResearchModeWebParameters;
}

export interface WebResearchPipelineOptions {
  searchProvider?: SearchProvider;
  evidenceLimit: number;
}

const DEFAULT_WEB_PARAMETERS: ResearchModeWebParameters = {
  deadlineMs: 20_000,
  perSourceLimit: 6,
  mergedLimit: 20,
  maxConcurrentSources: 6,
};

const MAX_FETCHES = 3;

interface PreparedWebResult {
  original: SearchProviderResult;
  effective?: SearchProviderResult;
  exclusionReason?: WebResultExclusionReason;
  contentFallbackReason?: "unreadable-fetched-content";
}

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
    const web = options.web ?? DEFAULT_WEB_PARAMETERS;
    const mode = options.mode ?? "instant";

    const queries = [question];

    yield { type: "status", message: "Searching web..." };
    let sourceSelection: WebSourceSelectionDiagnostics | undefined;
    const searchOptions: WebSearchOptions = {
      mode,
      limit: web.mergedLimit,
      perSourceLimit: web.perSourceLimit,
      deadlineMs: web.deadlineMs,
      maxConcurrentSources: web.maxConcurrentSources,
      maxFetches: MAX_FETCHES,
      onSourceSelection: (diagnostics) => {
        sourceSelection = diagnostics;
      },
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const search = {
      results: await this.searchProvider.search(question, searchOptions),
      requests: [{ query: question, limit: web.mergedLimit, maxFetches: MAX_FETCHES }],
    };
    const results = search.results;

    if (results.length === 0) {
      return {
        chunks: [],
        citations: [],
        diagnostics: createWebDiagnostics(
          question,
          "direct",
          queries,
          search.requests,
          [],
          [],
          0,
          sourceSelection,
        ),
      };
    }

    yield { type: "status", message: "Fetching sources..." };
    const preparedResults = prepareWebResults(results);
    const rankedResults = rankWebResults(
      preparedResults.flatMap((result) => (result.effective ? [result.effective] : [])),
      question,
    );
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
        preparedResults,
        rankedResults,
        evidenceLimit,
        sourceSelection,
      ),
    };
  }
}

function createWebDiagnostics(
  originalQuestion: string,
  queryStrategy: WebContextDiagnostics["queryStrategy"],
  queries: string[],
  requests: WebContextDiagnostics["requests"],
  preparedResults: PreparedWebResult[],
  rankedResults: SearchProviderResult[],
  evidenceLimit = 0,
  sourceSelection?: WebSourceSelectionDiagnostics,
): WebContextDiagnostics {
  const processingRanks = new Map(
    rankedResults.map((result, index) => [result, index + 1] as const),
  );

  return {
    originalQuestion,
    queryStrategy,
    queries,
    requests,
    results: preparedResults.map((prepared) => {
      const result = prepared.original;
      const effective = prepared.effective;
      const text =
        effective?.extractedText ??
        effective?.source.snippet ??
        result.extractedText ??
        result.source.snippet;
      const processingRank = effective ? processingRanks.get(effective) : undefined;
      const exceedsLimit = processingRank !== undefined && processingRank > evidenceLimit;
      const reason = prepared.exclusionReason ?? (exceedsLimit ? "web-evidence-limit" : undefined);

      return {
        chunkId: result.source.id,
        query: result.query,
        url: result.source.url,
        title: result.source.title,
        providerRank: result.rank,
        ...(processingRank !== undefined ? { processingRank } : {}),
        relevanceScore: webResultScore(
          effective ?? result,
          tokenSetForSearch(originalQuestion, { minLength: 3 }),
        ),
        wasContentFetched: result.source.wasContentFetched,
        textSource: effective
          ? effective.extractedText !== undefined
            ? "fetched-content"
            : "search-snippet"
          : result.extractedText !== undefined
            ? "fetched-content"
            : "search-snippet",
        textCharacters: text.length,
        estimatedTokens: estimateTextTokens(text),
        textPreview: normalizeInlineWhitespace(text).slice(0, 240),
        status: reason ? "dropped" : "candidate",
        ...(reason ? { reason } : {}),
        ...(prepared.contentFallbackReason
          ? { contentFallbackReason: prepared.contentFallbackReason }
          : {}),
      };
    }),
    finalPrompt: { includedChunkIds: [], usedTokens: 0 },
    ...(sourceSelection ? { sourceSelection } : {}),
  };
}

function prepareWebResults(results: SearchProviderResult[]): PreparedWebResult[] {
  const prepared = results.map((result) => prepareWebResult(result));
  const byCanonicalUrl = new Map<string, PreparedWebResult>();

  for (const candidate of prepared) {
    if (!candidate.effective) continue;
    const key = canonicalizeWebEvidenceUrl(candidate.effective.source.url);
    const existing = byCanonicalUrl.get(key);
    if (!existing) {
      byCanonicalUrl.set(key, candidate);
      continue;
    }
    if (isMoreSubstantive(candidate.effective, existing.effective!)) {
      existing.exclusionReason = "canonical-duplicate-url";
      existing.effective = undefined;
      byCanonicalUrl.set(key, candidate);
    } else {
      candidate.exclusionReason = "canonical-duplicate-url";
      candidate.effective = undefined;
    }
  }

  return prepared;
}

function prepareWebResult(result: SearchProviderResult): PreparedWebResult {
  if (result.extractedText !== undefined && !assessWebTextQuality(result.extractedText).readable) {
    if (!assessWebTextQuality(result.source.snippet).readable) {
      return { original: result, exclusionReason: "unreadable-web-content" };
    }
    return {
      original: result,
      effective: {
        ...result,
        extractedText: undefined,
        source: { ...result.source, wasContentFetched: false },
      },
      contentFallbackReason: "unreadable-fetched-content",
    };
  }

  return {
    original: result,
    effective: {
      ...result,
      source: { ...result.source, wasContentFetched: result.extractedText !== undefined },
    },
  };
}

function isMoreSubstantive(
  candidate: SearchProviderResult,
  existing: SearchProviderResult,
): boolean {
  const candidateFetched = candidate.extractedText !== undefined;
  const existingFetched = existing.extractedText !== undefined;
  if (candidateFetched !== existingFetched) return candidateFetched;

  const candidateLength = (candidate.extractedText ?? candidate.source.snippet).trim().length;
  const existingLength = (existing.extractedText ?? existing.source.snippet).trim().length;
  if (candidateLength !== existingLength) return candidateLength > existingLength;
  return candidate.rank < existing.rank;
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
