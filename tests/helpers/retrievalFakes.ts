import {
  EmbeddingProviderClient,
  IndexStore,
  RetrievedChunk,
  SourceReference,
} from "../../src/shared/types";

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
  adjacentResults: RetrievedChunk[] = [];
  directAdjacentResults: RetrievedChunk[] = [];
  directAdjacentRequests: Array<{ source: SourceReference; chunkId: string; radius: number }> = [];

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

  async searchKeywords(query: string): Promise<RetrievedChunk[]> {
    this.keywordQueries.push(query);
    return this.keywordResults;
  }

  async expandAdjacentChunks(chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    return this.adjacentResults.length > 0 ? this.adjacentResults : chunks;
  }

  async getAdjacentChunks(
    source: SourceReference,
    chunkId: string,
    radius: number,
  ): Promise<RetrievedChunk[]> {
    this.directAdjacentRequests.push({ source, chunkId, radius });
    return this.directAdjacentResults;
  }
}
