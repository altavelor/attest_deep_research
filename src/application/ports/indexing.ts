import { EmbeddedChunk, ExtractedChunk, RetrievedChunk } from "@core/model";
import { LanguageCode, LanguageInventoryItem } from "@core/model";

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

  recordDocumentImages?(
    entries: readonly DocumentImageManifestEntry[],
    scope: DocumentImageManifestScope,
  ): Promise<void>;
  commit(): Promise<void>;
  rollback(): void;
}

/**
 * How the recorded rows relate to the stored manifest. A full rebuild replaces
 * it; an incremental write replaces only the rows of the documents it touched,
 * so image discovery stays consistent with the index without a rebuild.
 */
export type DocumentImageManifestScope =
  { mode: "replace" } | { mode: "merge"; documentPaths: readonly string[] };

export interface DocumentImageManifestEntry {
  documentPath: string;
  contentHash: string;
  format: string;
  locator: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
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

export interface IndexChunkInventoryOptions {
  cursor?: string;
  limit: number;
  sourcePath?: string;
}

export interface IndexChunkInventoryStore {
  listIndexedChunks(options: IndexChunkInventoryOptions): Promise<{
    chunks: RetrievedChunk[];
    nextCursor?: string;
  }>;
}
