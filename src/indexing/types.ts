import type {
  EmbeddingProviderClient,
  ExtractedChunk,
  Extractor,
  IndexStore,
  IndexStoreWriteSession,
} from "../shared/types";
import type { FileSnapshot } from "./changeDetection";
import type { IndexingProgressState } from "./IndexingProgressState";

export interface VaultFileSummary {
  path: string;
  modifiedTime: number;
  size?: number;
}

export interface VaultFileProvider {
  listFiles(): Promise<VaultFileSummary[]>;
  readFile(path: string): Promise<ArrayBuffer | string>;
}

export type IndexingStatus = "idle" | "indexing" | "paused" | "stale" | "error";

export interface IndexingState {
  status: IndexingStatus;
  activeOperation?: "indexing" | "rebuild";
  scannedFiles: number;
  totalFiles: number;
  progress: number;
  indexedFiles: number;
  skippedFiles: number;
  embeddedChunks: number;
  deferredFiles: number;
  failedFiles: number;
  phase?: IndexingProgressPhase;
  currentFile?: string;
  bytesTotal?: number;
  bytesProcessed?: number;
  chunksTotal?: number;
  chunksEmbedded?: number;
  embeddingBatchesTotal?: number;
  embeddingBatchesCompleted?: number;
  lastIndexedAt?: string;
  lastUpdatedAt?: string;
  indexSizeBytes?: number;
  isStale: boolean;
  indexChanged?: boolean;
  errorMessage?: string;
}

export interface IndexSourceReportItem {
  sourcePath: string;
  status: "indexed" | "failed";
  modifiedTime: number;
  indexedAt: string;
  chunkCount: number;
  errorMessage?: string;
  languages?: string[];
}

export type IndexingProgressPhase =
  | "scanning"
  | "checking"
  | "extracting"
  | "chunking"
  | "embedding"
  | "writing"
  | "complete";

export interface IndexingServiceOptions {
  files: VaultFileProvider;
  extractors: Extractor[];
  embeddings: EmbeddingProviderClient;
  indexStore: IndexStore;
  embeddingModel: string;
  includeFolders: string[];
  excludeGlobs: string[];
  batchSize?: number;
  yieldEveryFiles?: number;
  maxChangedFilesPerRun?: number;
  yieldToEventLoop?: () => Promise<void>;
  onProgress?: (state: IndexingState) => void;
  logger?: IndexingLogger;
  now?: () => Date;
}

export interface IndexedFileResult {
  indexed: boolean;
  skipped: boolean;
  chunks: ExtractedChunk[];
  contentHash?: string;
  persistSnapshot?: boolean;
  languages?: string[];
}

export type PendingIndexedFile = VaultFileSummary & {
  contentHash: string;
  chunkCount: number;
  languages?: string[];
};

export type IndexingFileLogReason =
  | "unsupported-file-type"
  | "excluded-by-path"
  | "unchanged-metadata"
  | "unchanged-content"
  | "no-extractable-text"
  | "indexed"
  | "extraction-failed";

export interface IndexingFileLogEvent {
  path: string;
  outcome: "indexed" | "skipped" | "failed";
  reason: IndexingFileLogReason;
  modifiedTime: number;
  extractor?: string;
  chunkCount?: number;
  contentHash?: string;
  errorMessage?: string;
  errorDetails?: Record<string, unknown>;
}

export interface IndexingLogger {
  logIndexingFile(event: IndexingFileLogEvent): void;
  logIndexingPerformance?(event: IndexingPerformanceLogEvent): void;
}

export interface IndexingPerformanceLogEvent {
  phase:
  | IndexingProgressPhase
  | "readFile"
  | "hash"
  | "keywordBuild"
  | "vectorEncode"
  | "manifestBuild"
  | "diskWrite"
  | "persist";
  path?: string;
  durationMs: number;
  chunkCount?: number;
  batchSize?: number;
  batchIndex?: number;
  batchCount?: number;
  shardId?: string;
  dirtyShardCount?: number;
  writtenFileCount?: number;
}

export interface FileProcessorOptions {
  files: VaultFileProvider;
  extractors: Extractor[];
  includeFolders: string[];
  excludeGlobs: string[];
  snapshots: Map<string, FileSnapshot>;
  progress: IndexingProgressState;
  logger?: IndexingLogger;
}

export interface EmbeddingBatcherOptions {
  embeddings: EmbeddingProviderClient;
  embeddingModel: string;
  batchSize: number;
  indexStore: IndexStore;
  progress: IndexingProgressState;
  yieldToEventLoop: () => Promise<void>;
  logger?: IndexingLogger;
}

export interface EmbedAndStoreInput {
  chunks: ExtractedChunk[];
  sourcePathsToReplace: string[];
  getWriter?: () => Promise<IndexStoreWriteSession | undefined>;
}
