import { RetrievalResult } from "@application/contracts";
import { QueryExpansion } from "@application/contracts/research";
import { uniqueChunks } from "@core/model";
import { RetrievalQueryVariant } from "@core/retrieval";
import { ResearchRetriever, ResearchStreamEvent } from "@application/contracts/research";

export interface VaultSearchOptions {
  evidenceLimit?: number;
  maxVariants?: number;
  signal?: AbortSignal;
}

export interface VaultResearchPipelineOptions {
  retriever: ResearchRetriever;
  queryExpansion?: QueryExpansion;
  evidenceLimit: number;
}

export class VaultResearchPipeline {
  private readonly retriever: ResearchRetriever;
  private readonly queryExpansion?: QueryExpansion;
  private readonly evidenceLimit: number;

  constructor(options: VaultResearchPipelineOptions) {
    this.retriever = options.retriever;
    this.queryExpansion = options.queryExpansion;
    this.evidenceLimit = options.evidenceLimit;
  }

  /**
   * Search the vault for a question. Query expansion runs alongside the search
   * for the original query instead of gating it, and the linked-notes pass runs
   * alongside the primary one; neither can delay or fail the primary search.
   */
  async *search(
    question: string,
    contextPaths: string[] | undefined,
    boostedSourcePaths: string[] | undefined = undefined,
    options: VaultSearchOptions = {},
  ): AsyncGenerator<ResearchStreamEvent, RetrievalResult> {
    const limit = options.evidenceLimit ?? this.evidenceLimit;
    const expansionEnabled = this.queryExpansion !== undefined && this.canReadLanguageInventory();

    yield { type: "status", message: "Reading vault context..." };
    const queryVariants = this.buildQueryVariants(question, options.maxVariants, options.signal);

    if (expansionEnabled) {
      yield { type: "status", message: "Expanding search queries..." };
    }

    const primary = this.retriever.search(question, {
      limit,
      includeWebResults: false,
      queryVariants,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(contextPaths ? { sourcePaths: contextPaths } : {}),
    });
    const hasBoostedPaths = boostedSourcePaths !== undefined && boostedSourcePaths.length > 0;

    if (hasBoostedPaths) {
      yield { type: "status", message: "Searching linked notes..." };
    }

    const graph = hasBoostedPaths
      ? this.retriever.search(question, {
          limit,
          includeWebResults: false,
          queryVariants,
          ...(options.signal ? { signal: options.signal } : {}),
          sourcePaths: boostedSourcePaths,
        })
      : undefined;
    const [variants, primaryResult, graphResult] = await Promise.all([
      queryVariants,
      primary,
      graph,
    ]);

    if (!graphResult) {
      return { ...primaryResult, queryVariants: variants };
    }

    return {
      ...mergeRetrievalResults(primaryResult, graphResult, limit),
      queryVariants: variants,
    };
  }

  private canReadLanguageInventory(): boolean {
    return typeof this.retriever.getLanguageInventory === "function";
  }

  /** Never rejects: a failed expansion degrades to searching the original query. */
  private async buildQueryVariants(
    question: string,
    maxVariants: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<RetrievalQueryVariant[] | undefined> {
    const queryExpansion = this.queryExpansion;

    if (!queryExpansion || !this.retriever.getLanguageInventory) {
      return undefined;
    }

    try {
      const languageInventory = await this.retriever.getLanguageInventory();

      if (languageInventory.length === 0) {
        return undefined;
      }

      const variants = await queryExpansion.buildVariants({
        query: question,
        languageInventory,
        ...(maxVariants !== undefined ? { maxVariants } : {}),
        ...(signal ? { signal } : {}),
      });

      return variants.length > 0 ? variants : undefined;
    } catch {
      return undefined;
    }
  }
}

function mergeRetrievalResults(
  primary: RetrievalResult,
  graph: RetrievalResult,
  limit: number,
): RetrievalResult {
  const graphLimit = Math.min(graph.chunks.length, Math.max(1, Math.ceil(limit * 0.25)));
  const chunks = uniqueChunks([
    ...graph.chunks.slice(0, graphLimit),
    ...primary.chunks,
    ...graph.chunks.slice(graphLimit),
  ]).slice(0, limit);
  const citationIds = new Set(chunks.map((chunk) => chunk.id));
  const citations = uniqueCitations([...graph.citations, ...primary.citations]).filter((citation) =>
    citationIds.has(citation.id),
  );

  return {
    chunks,
    citations,
    usedFallback: primary.usedFallback && graph.usedFallback,
  };
}

function uniqueCitations(citations: RetrievalResult["citations"]): RetrievalResult["citations"] {
  const seen = new Set<string>();
  const unique: RetrievalResult["citations"] = [];

  for (const citation of citations) {
    if (seen.has(citation.id)) {
      continue;
    }

    seen.add(citation.id);
    unique.push(citation);
  }

  return unique;
}
