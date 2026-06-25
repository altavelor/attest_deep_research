// Application ports: retrieval contracts (stage 1, task 1.3).

import { RetrievedChunk, SourceKind, SourceReference } from "../../core/model/source";
import { LanguageCode } from "../../core/model/citation";

export interface RetrievalOptions {
  limit: number;
  includeWebResults: boolean;
  minScore?: number;
  sourceKinds?: SourceKind[];
  fileExtensions?: string[];
  sourcePaths?: string[];
  boostedSourcePaths?: string[];
  queryVariants?: RetrievalQueryVariant[];
}

export interface RetrievalQueryVariant {
  query: string;
  language?: LanguageCode;
  reason?: "original" | "expanded" | "translated";
}

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
