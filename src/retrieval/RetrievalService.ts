import {
  Citation,
  EmbeddingProviderClient,
  IndexStore,
  KeywordSearchIndexStore,
  RetrievedChunk,
  RetrievalOptions,
} from "../shared/types";
import { formatCitation } from "./citations";
import { rankKeywordMatches } from "./ranking";
import { filterRetrievedChunks } from "./retrievalFilters";

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
    const semanticChunks = filterRetrievedChunks(
      await this.searchSemantic(query, options.limit),
      options,
    );
    const chunks =
      semanticChunks.length > 0 ? semanticChunks : await this.searchKeywords(query, options);

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
    return filterRetrievedChunks(this.keywordCorpus, options);
  }

  private async searchKeywords(
    query: string,
    options: RetrievalOptions,
  ): Promise<RetrievedChunk[]> {
    if (isKeywordSearchIndexStore(this.indexStore)) {
      const chunks = await this.indexStore.searchKeywords(query, options);

      if (chunks.length > 0) {
        return chunks;
      }
    }

    return rankKeywordMatches(query, this.keywordCorpusForOptions(options), options.limit);
  }
}

function isKeywordSearchIndexStore(
  indexStore: IndexStore,
): indexStore is IndexStore & KeywordSearchIndexStore {
  return "searchKeywords" in indexStore && typeof indexStore.searchKeywords === "function";
}
