import { RetrievalResult } from "@application/contracts";
import { QueryExpansion } from "@application/contracts/research";
import { RetrievalQueryVariant } from "@core/retrieval";
import { ResearchRetriever, ResearchStreamEvent } from "@application/contracts/research";

export interface VaultSearchOptions {
  evidenceLimit?: number;
  maxVariants?: number;
  signal?: AbortSignal;
}

export interface VaultResearchPipelineOptions {
  retriever?: ResearchRetriever;
  queryExpansion?: QueryExpansion;
  evidenceLimit: number;
}

export class VaultResearchPipeline {
  private readonly retriever?: ResearchRetriever;
  private readonly queryExpansion?: QueryExpansion;
  private readonly evidenceLimit: number;

  constructor(options: VaultResearchPipelineOptions) {
    this.retriever = options.retriever;
    this.queryExpansion = options.queryExpansion;
    this.evidenceLimit = options.evidenceLimit;
  }

  /**
   * Search the vault for a question. Query expansion runs alongside the search
   * for the original query instead of gating it, so it can neither delay nor
   * fail that search. Linked notes are promoted by the retriever's ranking.
   * Without a retriever — a web-only turn — the search yields no evidence.
   */
  async *search(
    question: string,
    contextPaths: string[] | undefined,
    boostedSourcePaths: string[] | undefined = undefined,
    options: VaultSearchOptions = {},
  ): AsyncGenerator<ResearchStreamEvent, RetrievalResult> {
    const retriever = this.retriever;
    if (!retriever) {
      return { chunks: [], citations: [], usedFallback: false };
    }

    const limit = options.evidenceLimit ?? this.evidenceLimit;
    const expansionEnabled = this.queryExpansion !== undefined && this.canReadLanguageInventory();

    yield { type: "status", message: "Reading vault context..." };
    const queryVariants = this.buildQueryVariants(question, options.maxVariants, options.signal);

    if (expansionEnabled) {
      yield { type: "status", message: "Expanding search queries..." };
    }

    const hasBoostedPaths = boostedSourcePaths !== undefined && boostedSourcePaths.length > 0;
    const search = retriever.search(question, {
      limit,
      includeWebResults: false,
      queryVariants,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(contextPaths ? { sourcePaths: contextPaths } : {}),
      ...(hasBoostedPaths ? { boostedSourcePaths } : {}),
    });
    const [variants, result] = await Promise.all([queryVariants, search]);

    return { ...result, queryVariants: variants };
  }

  private canReadLanguageInventory(): boolean {
    return typeof this.retriever?.getLanguageInventory === "function";
  }

  /** Never rejects: a failed expansion degrades to searching the original query. */
  private async buildQueryVariants(
    question: string,
    maxVariants: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<RetrievalQueryVariant[] | undefined> {
    const queryExpansion = this.queryExpansion;
    const readLanguageInventory = this.retriever?.getLanguageInventory?.bind(this.retriever);

    if (!queryExpansion || !readLanguageInventory) {
      return undefined;
    }

    try {
      const languageInventory = await readLanguageInventory();

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
