import { IndexStore } from "@application/ports";
import { EmbeddingProviderClient } from "@core/agent";
import { RetrievedChunk } from "@core/model";
import { RetrievalOptions } from "@core/retrieval";
import { filterRetrievedChunks } from "@core/retrieval";

export class FakeEmbeddingProvider implements EmbeddingProviderClient {
  constructor(private readonly embeddings: number[][]) { }

  async listModels(): Promise<string[]> {
    return ["nomic"];
  }

  async embed(): Promise<{ model: string; embeddings: number[][] }> {
    return { model: "nomic", embeddings: this.embeddings };
  }
}

export class FailingEmbeddingProvider implements EmbeddingProviderClient {
  async listModels(): Promise<string[]> {
    return [];
  }

  async embed(): Promise<{ model: string; embeddings: number[][] }> {
    throw new Error("embedding unavailable");
  }
}

export class FakeIndexStore implements IndexStore {
  initializations: Array<{ embeddingModel: string; embeddingDimensions: number }> = [];
  queries: Array<{ embedding: number[]; limit: number }> = [];
  keywordQueries: string[] = [];
  keywordResults: RetrievedChunk[] = [];
  keywordResultsByQuery = new Map<string, RetrievedChunk[]>();

  constructor(private readonly chunks: RetrievedChunk[]) { }

  async initialize(metadata: {
    embeddingModel: string;
    embeddingDimensions: number;
  }): Promise<void> {
    this.initializations.push(metadata);
  }

  async upsert(): Promise<void> { }

  async deleteBySourcePath(): Promise<void> { }

  async clear(): Promise<void> { }

  async query(embedding: number[], limit: number): Promise<RetrievedChunk[]> {
    this.queries.push({ embedding, limit });
    return this.chunks.slice(0, limit);
  }

  async searchKeywords(query: string, options?: RetrievalOptions): Promise<RetrievedChunk[]> {
    this.keywordQueries.push(query);
    const queryResults = this.keywordResultsByQuery.get(query);
    const results = queryResults ?? this.keywordResults;
    return options ? filterRetrievedChunks(results, options) : results;
  }
}
