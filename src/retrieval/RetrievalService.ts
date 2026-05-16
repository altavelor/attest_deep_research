import {
  Citation,
  EmbeddingProviderClient,
  IndexStore,
  RetrievedChunk,
  RetrievalOptions,
} from "../shared/types";
import { formatCitation } from "./citations";
import { rankKeywordMatches } from "./ranking";

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  usedFallback: boolean;
}

export interface RetrievalServiceOptions {
  embeddings: EmbeddingProviderClient;
  indexStore: IndexStore;
  embeddingModel: string;
  keywordCorpus: RetrievedChunk[];
}

export class RetrievalService {
  private readonly embeddings: EmbeddingProviderClient;
  private readonly indexStore: IndexStore;
  private readonly embeddingModel: string;
  private readonly keywordCorpus: RetrievedChunk[];

  constructor(options: RetrievalServiceOptions) {
    this.embeddings = options.embeddings;
    this.indexStore = options.indexStore;
    this.embeddingModel = options.embeddingModel;
    this.keywordCorpus = options.keywordCorpus;
  }

  async search(query: string, options: RetrievalOptions): Promise<RetrievalResult> {
    const semanticChunks = await this.searchSemantic(query, options.limit);
    const chunks =
      semanticChunks.length > 0
        ? semanticChunks
        : rankKeywordMatches(query, this.keywordCorpusForOptions(options), options.limit);

    return {
      chunks,
      citations: chunks.map((chunk) => ({
        ...formatCitation(chunk.source),
        id: chunk.id,
      })),
      usedFallback: semanticChunks.length === 0,
    };
  }

  private async searchSemantic(query: string, limit: number): Promise<RetrievedChunk[]> {
    try {
      const response = await this.embeddings.embed({
        model: this.embeddingModel,
        input: [query],
      });
      const embedding = response.embeddings[0];

      if (!embedding) {
        return [];
      }

      await this.indexStore.initialize({
        embeddingModel: this.embeddingModel,
        embeddingDimensions: embedding.length,
      });

      return this.indexStore.query(embedding, limit);
    } catch {
      return [];
    }
  }

  private keywordCorpusForOptions(options: RetrievalOptions): RetrievedChunk[] {
    if (options.includeWebResults) {
      return this.keywordCorpus;
    }

    return this.keywordCorpus.filter((chunk) => chunk.source.kind !== "web");
  }
}
