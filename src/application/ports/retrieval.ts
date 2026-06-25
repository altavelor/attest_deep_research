// Application ports: retrieval contracts (stage 1, task 1.3).
// Query DTOs moved to core/retrieval/query (stage 2); re-exported here for
// existing importers. The interfaces below are outbound ports (implemented by
// index-store adapters), so they remain in the application layer.

import { RetrievedChunk, SourceReference } from "../../core/model/source";
import { RetrievalOptions } from "../../core/retrieval/query";

export type { RetrievalOptions, RetrievalQueryVariant } from "../../core/retrieval/query";

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
