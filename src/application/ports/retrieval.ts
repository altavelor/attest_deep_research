import { RetrievedChunk, SourceReference } from "../../core/model/source";
import { RetrievalOptions } from "../../core/retrieval/query";

export interface KeywordSearchIndexStore {
  searchKeywords(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}

export interface AdjacentChunkIndexStore {
  expandAdjacentChunks(
    chunks: RetrievedChunk[],
    radius: number,
    limit: number,
  ): Promise<RetrievedChunk[]>;
  getAdjacentChunks(
    source: SourceReference,
    chunkId: string,
    radius: number,
  ): Promise<RetrievedChunk[]>;
}

export interface Retriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}
