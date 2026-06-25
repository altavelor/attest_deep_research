// Application ports: indexing / extraction / index-store contracts (stage 1, task 1.3).
// Depend only on core domain model.

import { EmbeddedChunk, ExtractedChunk, RetrievedChunk } from "../../core/model/source";
import { LanguageCode, LanguageInventoryItem } from "../../core/model/citation";

export interface ExtractorInput {
  path: string;
  data: ArrayBuffer | string;
  modifiedTime: number;
  size?: number;
}

export interface Extractor {
  supports(path: string): boolean;
  extract(input: ExtractorInput): Promise<ExtractedChunk[]>;
}

export interface IndexStoreMetadata {
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface IndexStore {
  initialize(metadata: IndexStoreMetadata): Promise<void>;
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  deleteBySourcePath(path: string): Promise<void>;
  clear(): Promise<void>;
  query(embedding: number[], limit: number): Promise<RetrievedChunk[]>;
  beginWrite?(): Promise<IndexStoreWriteSession>;
}

export interface IndexStoreWriteSession {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  deleteBySourcePath(path: string): Promise<void>;
  updateSourceSnapshots?(snapshots: IndexSourceSnapshot[]): Promise<void>;
  recordFailedSourceSnapshots?(snapshots: IndexFailedSourceSnapshot[]): Promise<void>;
  commit(): Promise<void>;
  rollback(): void;
}

export interface IndexSourceSnapshot {
  sourcePath: string;
  modifiedTime: number;
  contentHash: string;
  languages?: LanguageCode[];
}

export interface IndexFailedSourceSnapshot {
  sourcePath: string;
  modifiedTime: number;
  errorMessage: string;
  indexedAt: string;
}

export interface SourceSnapshotIndexStore {
  loadSourceSnapshots(): Promise<IndexSourceSnapshot[]>;
  updateSourceSnapshots(snapshots: IndexSourceSnapshot[]): Promise<void>;
  recordFailedSourceSnapshots?(snapshots: IndexFailedSourceSnapshot[]): Promise<void>;
}

export interface LanguageInventoryIndexStore {
  getLanguageInventory(): Promise<LanguageInventoryItem[]>;
}
