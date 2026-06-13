import { RetrievalResult } from "../retrieval/RetrievalService";
import { QueryExpansionService } from "../retrieval/QueryExpansionService";
import { RetrievalQueryVariant } from "../shared/types";
import { ResearchRetriever, ResearchStreamEvent } from "./types";

export interface VaultResearchPipelineOptions {
  retriever: ResearchRetriever;
  queryExpansion?: QueryExpansionService;
  evidenceLimit: number;
}

export class VaultResearchPipeline {
  private readonly retriever: ResearchRetriever;
  private readonly queryExpansion?: QueryExpansionService;
  private readonly evidenceLimit: number;

  constructor(options: VaultResearchPipelineOptions) {
    this.retriever = options.retriever;
    this.queryExpansion = options.queryExpansion;
    this.evidenceLimit = options.evidenceLimit;
  }

  async *search(
    question: string,
    contextPaths: string[] | undefined,
  ): AsyncGenerator<ResearchStreamEvent, RetrievalResult> {
    yield { type: "status", message: "Reading vault context..." };
    const queryVariants = yield* this.buildQueryVariants(question);

    return this.retriever.search(question, {
      limit: this.evidenceLimit,
      includeWebResults: false,
      queryVariants,
      ...(contextPaths ? { sourcePaths: contextPaths } : {}),
    });
  }

  private async *buildQueryVariants(
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
}
