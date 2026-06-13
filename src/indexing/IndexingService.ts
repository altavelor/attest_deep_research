import { isIxplorerError, IxplorerError } from "../shared/errors";
import {
  EmbeddedChunk,
  EmbeddingProviderClient,
  ExtractedChunk,
  Extractor,
  IndexFailedSourceSnapshot,
  IndexStore,
  IndexStoreWriteSession,
  SourceSnapshotIndexStore,
} from "../shared/types";
import { FileSnapshot, hashFileData, shouldIndexFile, updateSnapshot } from "./changeDetection";
import { detectTextLanguages } from "./languageDetection";

export interface VaultFileSummary {
  path: string;
  modifiedTime: number;
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
  errorMessage?: string;
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

interface IndexedFileResult {
  indexed: boolean;
  skipped: boolean;
  chunks: ExtractedChunk[];
  contentHash?: string;
  persistSnapshot?: boolean;
  languages?: string[];
}

type PendingIndexedFile = VaultFileSummary & {
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

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_YIELD_EVERY_FILES = 25;
const INTERNAL_EXCLUDE_GLOBS = [".ixplorer/**"];

export class IndexingService {
  private readonly files: VaultFileProvider;
  private readonly extractors: Extractor[];
  private readonly embeddings: EmbeddingProviderClient;
  private readonly indexStore: IndexStore;
  private readonly embeddingModel: string;
  private readonly includeFolders: string[];
  private readonly excludeGlobs: string[];
  private readonly batchSize: number;
  private readonly yieldEveryFiles: number;
  private readonly maxChangedFilesPerRun?: number;
  private readonly yieldToEventLoop: () => Promise<void>;
  private readonly onProgress?: (state: IndexingState) => void;
  private readonly logger?: IndexingLogger;
  private readonly now: () => Date;
  private snapshotsLoaded = false;
  private readonly snapshots = new Map<string, FileSnapshot>();
  private state: IndexingState = {
    status: "idle",
    scannedFiles: 0,
    totalFiles: 0,
    progress: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    embeddedChunks: 0,
    deferredFiles: 0,
    failedFiles: 0,
    isStale: false,
  };

  constructor(options: IndexingServiceOptions) {
    this.files = options.files;
    this.extractors = options.extractors;
    this.embeddings = options.embeddings;
    this.indexStore = options.indexStore;
    this.embeddingModel = options.embeddingModel;
    this.includeFolders = options.includeFolders;
    this.excludeGlobs = options.excludeGlobs;
    this.batchSize = positiveIntegerOrDefault(options.batchSize, DEFAULT_BATCH_SIZE);
    this.yieldEveryFiles = positiveIntegerOrDefault(
      options.yieldEveryFiles,
      DEFAULT_YIELD_EVERY_FILES,
    );
    this.maxChangedFilesPerRun = options.maxChangedFilesPerRun;
    this.yieldToEventLoop = options.yieldToEventLoop ?? defaultYieldToEventLoop;
    this.onProgress = options.onProgress;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
  }

  getState(): IndexingState {
    return { ...this.state };
  }

  pause(): void {
    this.state = { ...this.state, status: "paused", lastUpdatedAt: this.now().toISOString() };
    this.notifyProgress();
  }

  resume(): void {
    if (this.state.status === "paused") {
      this.state = { ...this.state, status: "idle", lastUpdatedAt: this.now().toISOString() };
      this.notifyProgress();
    }
  }

  markStale(): void {
    if (this.state.status === "indexing" || this.state.status === "paused") {
      this.state = { ...this.state, isStale: true, lastUpdatedAt: this.now().toISOString() };
    } else {
      this.state = {
        ...this.state,
        status: "stale",
        isStale: true,
        errorMessage: undefined,
        lastUpdatedAt: this.now().toISOString(),
      };
    }
    this.notifyProgress();
  }

  setIndexSizeBytes(indexSizeBytes?: number): void {
    this.state = { ...this.state, indexSizeBytes };
    this.notifyProgress();
  }

  async clear(): Promise<void> {
    await this.indexStore.clear();
    this.snapshots.clear();
    this.state = {
      status: this.state.status === "paused" ? "paused" : "idle",
      scannedFiles: 0,
      totalFiles: 0,
      progress: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      embeddedChunks: 0,
      deferredFiles: 0,
      failedFiles: 0,
      indexSizeBytes: this.state.indexSizeBytes,
      isStale: false,
      errorMessage: undefined,
      lastUpdatedAt: this.now().toISOString(),
    };
    this.notifyProgress();
  }

  async rebuild(): Promise<IndexingState> {
    await this.indexStore.clear();
    this.snapshots.clear();
    if (this.state.status === "paused") {
      this.state = { ...this.state, status: "idle" };
    }
    return this.manualReindex("rebuild");
  }

  async manualReindex(
    activeOperation: "indexing" | "rebuild" = "indexing",
  ): Promise<IndexingState> {
    if (this.state.status === "paused") {
      return this.getState();
    }

    this.state = {
      status: "indexing",
      activeOperation,
      scannedFiles: 0,
      totalFiles: 0,
      progress: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      embeddedChunks: 0,
      deferredFiles: 0,
      failedFiles: 0,
      indexSizeBytes: this.state.indexSizeBytes,
      isStale: false,
      errorMessage: undefined,
      lastUpdatedAt: this.now().toISOString(),
    };
    this.notifyProgress();

    const files = await this.files.listFiles();
    await this.loadPersistedSnapshots();
    this.state = {
      ...this.state,
      totalFiles: files.length,
      progress: files.length === 0 ? 1 : 0,
      lastUpdatedAt: this.now().toISOString(),
    };
    this.notifyProgress();
    const pendingChunks: ExtractedChunk[] = [];
    const pendingIndexedFiles: PendingIndexedFile[] = [];
    let writer: IndexStoreWriteSession | undefined;
    const getWriter = async (): Promise<IndexStoreWriteSession | undefined> => {
      if (!supportsWriteSession(this.indexStore)) {
        return undefined;
      }

      writer ??= await this.indexStore.beginWrite();
      return writer;
    };

    try {
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];

        if (this.state.status === "paused") {
          break;
        }

        let result: IndexedFileResult;

        try {
          result = await this.processFile(file);
        } catch (error) {
          const errorMessage = indexingErrorMessage(error);
          const failedSnapshot: IndexFailedSourceSnapshot = {
            sourcePath: file.path,
            modifiedTime: file.modifiedTime,
            errorMessage,
            indexedAt: this.now().toISOString(),
          };
          await this.persistFailedSourceSnapshots([failedSnapshot], writer);
          result = { indexed: false, skipped: false, chunks: [] };
          this.state = { ...this.state, failedFiles: this.state.failedFiles + 1 };
          this.logIndexingFile({
            path: file.path,
            outcome: "failed",
            reason: "extraction-failed",
            modifiedTime: file.modifiedTime,
            errorMessage,
            errorDetails: indexingErrorDetails(error),
          });
        }

        this.state = {
          ...this.state,
          scannedFiles: this.state.scannedFiles + 1,
          phase: "checking",
          currentFile: file.path,
          progress: calculateProgress(this.state.scannedFiles + 1, this.state.totalFiles),
          lastUpdatedAt: this.now().toISOString(),
        };

        if (result.skipped) {
          this.state = { ...this.state, skippedFiles: this.state.skippedFiles + 1 };
        }

        if (result.indexed && result.contentHash) {
          this.state = { ...this.state, indexedFiles: this.state.indexedFiles + 1 };
          pendingIndexedFiles.push({
            ...file,
            contentHash: result.contentHash,
            chunkCount: result.chunks.length,
            languages: result.languages,
          });
          pendingChunks.push(...result.chunks);
        }

        if (!result.indexed && result.persistSnapshot && result.contentHash) {
          pendingIndexedFiles.push({
            ...file,
            contentHash: result.contentHash,
            chunkCount: result.chunks.length,
            languages: result.languages,
          });
        }

        if (pendingChunks.length >= this.batchSize || this.shouldYieldAfterFile()) {
          await this.flushPendingChunks(
            pendingChunks,
            pendingIndexedFiles,
            getWriter,
            () => writer,
          );
        }

        this.notifyProgress();

        if (this.hasReachedChangedFileCap()) {
          const deferredFiles = files.length - fileIndex - 1;
          this.state = {
            ...this.state,
            deferredFiles,
            isStale: deferredFiles > 0,
            lastUpdatedAt: this.now().toISOString(),
          };
          break;
        }

        if (this.shouldYieldAfterFile()) {
          await this.yieldToEventLoop();
        }
      }

      if (this.state.status !== "paused") {
        await this.flushPendingChunks(pendingChunks, pendingIndexedFiles, getWriter, () => writer);
        this.state = { ...this.state, phase: "writing", lastUpdatedAt: this.now().toISOString() };
        this.notifyProgress();
        await writer?.commit();
      } else {
        writer?.rollback();
      }
    } catch (error) {
      writer?.rollback();
      throw error;
    }

    if (this.state.status !== "paused") {
      this.state = {
        ...this.state,
        status: this.state.deferredFiles > 0 ? "stale" : "idle",
        activeOperation: undefined,
        phase: "complete",
        currentFile: undefined,
        progress: 1,
        isStale: this.state.deferredFiles > 0,
        errorMessage: undefined,
        lastIndexedAt: this.now().toISOString(),
        lastUpdatedAt: this.now().toISOString(),
      };
    } else {
      this.state = {
        ...this.state,
        activeOperation: undefined,
        lastUpdatedAt: this.now().toISOString(),
      };
    }

    this.notifyProgress();

    return this.getState();
  }

  private shouldYieldAfterFile(): boolean {
    return this.state.scannedFiles > 0 && this.state.scannedFiles % this.yieldEveryFiles === 0;
  }

  private hasReachedChangedFileCap(): boolean {
    if (this.maxChangedFilesPerRun === undefined || this.maxChangedFilesPerRun <= 0) {
      return false;
    }

    return this.state.indexedFiles + this.state.failedFiles >= this.maxChangedFilesPerRun;
  }

  private async flushPendingChunks(
    chunks: ExtractedChunk[],
    indexedFiles: PendingIndexedFile[],
    getWriter?: () => Promise<IndexStoreWriteSession | undefined>,
    getCurrentWriter?: () => IndexStoreWriteSession | undefined,
  ): Promise<void> {
    const startedAt = Date.now();
    if (chunks.length === 0 && indexedFiles.length === 0) {
      return;
    }

    const sourcePathsToReplace = indexedFiles.map((file) => file.path);
    const embeddedChunks =
      chunks.length > 0
        ? await this.embedAndStoreChunks(chunks, sourcePathsToReplace, getWriter)
        : [];

    if (chunks.length === 0) {
      for (const sourcePath of sourcePathsToReplace) {
        await this.indexStore.deleteBySourcePath(sourcePath);
      }
    }

    for (const file of indexedFiles) {
      updateSnapshot(this.snapshots, file);
      if (file.chunkCount > 0) {
        this.logIndexingFile({
          path: file.path,
          outcome: "indexed",
          reason: "indexed",
          modifiedTime: file.modifiedTime,
          contentHash: file.contentHash,
          chunkCount: file.chunkCount,
        });
      }
    }
    await this.persistSourceSnapshots(indexedFiles, getCurrentWriter?.());

    chunks.length = 0;
    indexedFiles.length = 0;
    this.state = {
      ...this.state,
      embeddedChunks: this.state.embeddedChunks + embeddedChunks.length,
      lastUpdatedAt: this.now().toISOString(),
    };
    this.notifyProgress();
    this.logIndexingPerformance({
      phase: "writing",
      durationMs: Date.now() - startedAt,
      chunkCount: embeddedChunks.length,
    });
  }

  private async processFile(file: VaultFileSummary): Promise<IndexedFileResult> {
    const extractor = this.extractors.find((candidate) => candidate.supports(file.path));

    if (!extractor) {
      this.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "unsupported-file-type",
        modifiedTime: file.modifiedTime,
      });
      return { indexed: false, skipped: true, chunks: [] };
    }

    if (!this.shouldScanPath(file.path)) {
      this.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "excluded-by-path",
        modifiedTime: file.modifiedTime,
        extractor: extractor.constructor.name,
      });
      return { indexed: false, skipped: true, chunks: [] };
    }

    if (!shouldIndexFile(this.snapshots, file)) {
      this.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "unchanged-metadata",
        modifiedTime: file.modifiedTime,
        extractor: extractor.constructor.name,
      });
      return { indexed: false, skipped: true, chunks: [] };
    }

    this.state = { ...this.state, phase: "extracting", currentFile: file.path };
    this.notifyProgress();
    const readStartedAt = Date.now();
    const data = await this.files.readFile(file.path);
    this.logIndexingPerformance({
      phase: "readFile",
      path: file.path,
      durationMs: Date.now() - readStartedAt,
    });
    const hashStartedAt = Date.now();
    const contentHash = hashFileData(data);
    this.logIndexingPerformance({
      phase: "hash",
      path: file.path,
      durationMs: Date.now() - hashStartedAt,
    });

    if (!shouldIndexFile(this.snapshots, { ...file, contentHash })) {
      updateSnapshot(this.snapshots, { ...file, contentHash });
      this.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "unchanged-content",
        modifiedTime: file.modifiedTime,
        extractor: extractor.constructor.name,
        contentHash,
      });
      return { indexed: false, skipped: true, chunks: [] };
    }

    const extractionStartedAt = Date.now();
    const chunks = await extractor.extract({
      path: file.path,
      data,
      modifiedTime: file.modifiedTime,
    });
    this.logIndexingPerformance({
      phase: "extracting",
      path: file.path,
      durationMs: Date.now() - extractionStartedAt,
      chunkCount: chunks.length,
    });

    if (chunks.length === 0) {
      const languages = detectTextLanguages(String(data));
      this.logIndexingFile({
        path: file.path,
        outcome: "skipped",
        reason: "no-extractable-text",
        modifiedTime: file.modifiedTime,
        extractor: extractor.constructor.name,
        contentHash,
        chunkCount: 0,
      });

      return {
        indexed: false,
        skipped: true,
        chunks,
        contentHash,
        persistSnapshot: true,
        languages,
      };
    }

    const languages = detectTextLanguages(chunks.map((chunk) => chunk.text).join("\n\n"));

    return {
      indexed: true,
      skipped: false,
      chunks,
      contentHash,
      languages,
    };
  }

  private async embedAndStoreChunks(
    chunks: ExtractedChunk[],
    sourcePathsToReplace: string[],
    getWriter?: () => Promise<IndexStoreWriteSession | undefined>,
  ): Promise<EmbeddedChunk[]> {
    const embeddedChunks: EmbeddedChunk[] = [];
    const embeddingBatchesTotal = Math.ceil(chunks.length / this.batchSize);
    let deletedExistingSources = false;

    for (let start = 0; start < chunks.length; start += this.batchSize) {
      const batch = chunks.slice(start, start + this.batchSize);

      if (batch.length === 0) {
        continue;
      }

      if (this.state.status === "paused") {
        break;
      }

      this.state = {
        ...this.state,
        phase: "embedding",
        chunksTotal: chunks.length,
        chunksEmbedded: embeddedChunks.length,
        embeddingBatchesTotal,
        embeddingBatchesCompleted: Math.floor(start / this.batchSize),
        lastUpdatedAt: this.now().toISOString(),
      };
      this.notifyProgress();
      const embeddingStartedAt = Date.now();
      const response = await this.embeddings.embed({
        model: this.embeddingModel,
        input: batch.map(textForEmbedding),
      });
      this.logIndexingPerformance({
        phase: "embedding",
        durationMs: Date.now() - embeddingStartedAt,
        chunkCount: batch.length,
        batchSize: batch.length,
        batchIndex: Math.floor(start / this.batchSize) + 1,
        batchCount: embeddingBatchesTotal,
      });
      const batchEmbeddings = batch.map((chunk, index) => ({
        ...chunk,
        embedding: response.embeddings[index],
        embeddingModel: response.model,
      }));

      if (batchEmbeddings.length > 0) {
        await this.ensureStoreInitialized(batchEmbeddings[0].embedding.length);
        const storeWriter = (await getWriter?.()) ?? this.indexStore;
        if (!deletedExistingSources) {
          for (const sourcePath of sourcePathsToReplace) {
            await storeWriter.deleteBySourcePath(sourcePath);
          }
          deletedExistingSources = true;
        }
        await storeWriter.upsert(batchEmbeddings);
        embeddedChunks.push(...batchEmbeddings);
      }
      this.state = {
        ...this.state,
        chunksEmbedded: embeddedChunks.length,
        embeddingBatchesCompleted: Math.floor(start / this.batchSize) + 1,
        lastUpdatedAt: this.now().toISOString(),
      };

      await this.yieldToEventLoop();
    }

    return embeddedChunks;
  }

  private async ensureStoreInitialized(embeddingDimensions: number): Promise<void> {
    await this.indexStore.initialize({
      embeddingModel: this.embeddingModel,
      embeddingDimensions,
    });
  }

  private async loadPersistedSnapshots(): Promise<void> {
    if (this.snapshotsLoaded || !isSourceSnapshotIndexStore(this.indexStore)) {
      this.snapshotsLoaded = true;
      return;
    }

    const snapshots = await this.indexStore.loadSourceSnapshots();
    for (const snapshot of snapshots) {
      this.snapshots.set(snapshot.sourcePath, {
        modifiedTime: snapshot.modifiedTime,
        contentHash: snapshot.contentHash,
      });
    }
    this.snapshotsLoaded = true;
  }

  private async persistSourceSnapshots(
    indexedFiles: PendingIndexedFile[],
    writer?: IndexStoreWriteSession,
  ): Promise<void> {
    if (!isSourceSnapshotIndexStore(this.indexStore) || indexedFiles.length === 0) {
      return;
    }

    const snapshots = indexedFiles.map((file) => ({
      sourcePath: file.path,
      modifiedTime: file.modifiedTime,
      contentHash: file.contentHash,
      languages: file.languages,
    }));

    if (writer?.updateSourceSnapshots) {
      await writer.updateSourceSnapshots(snapshots);
    } else {
      await this.indexStore.updateSourceSnapshots(snapshots);
    }
  }

  private async persistFailedSourceSnapshots(
    snapshots: IndexFailedSourceSnapshot[],
    writer?: IndexStoreWriteSession,
  ): Promise<void> {
    if (
      !isSourceSnapshotIndexStore(this.indexStore) ||
      !this.indexStore.recordFailedSourceSnapshots
    ) {
      return;
    }

    if (writer?.recordFailedSourceSnapshots) {
      await writer.recordFailedSourceSnapshots(snapshots);
    } else {
      await this.indexStore.recordFailedSourceSnapshots(snapshots);
    }
  }

  private shouldScanPath(path: string): boolean {
    return (
      isIncluded(path, this.includeFolders) &&
      !INTERNAL_EXCLUDE_GLOBS.some((glob) => globMatches(path, glob)) &&
      !this.excludeGlobs.some((glob) => globMatches(path, glob))
    );
  }

  private notifyProgress(): void {
    this.onProgress?.(this.getState());
  }

  private logIndexingFile(event: IndexingFileLogEvent): void {
    this.logger?.logIndexingFile(event);
  }

  private logIndexingPerformance(event: IndexingPerformanceLogEvent): void {
    this.logger?.logIndexingPerformance?.(event);
  }
}

function defaultYieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function supportsWriteSession(
  store: IndexStore,
): store is IndexStore & { beginWrite(): Promise<IndexStoreWriteSession> } {
  return typeof store.beginWrite === "function";
}

function calculateProgress(scannedFiles: number, totalFiles: number): number {
  if (totalFiles <= 0) {
    return 0;
  }

  return Math.min(1, scannedFiles / totalFiles);
}

function isIncluded(path: string, includeFolders: string[]): boolean {
  return includeFolders.some((folder) => {
    const normalizedFolder = normalizeFolder(folder);

    return (
      normalizedFolder === "" ||
      path === normalizedFolder ||
      path.startsWith(`${normalizedFolder}/`)
    );
  });
}

function normalizeFolder(folder: string): string {
  const normalized = folder.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

  return normalized === "." ? "" : normalized;
}

function globMatches(path: string, glob: string): boolean {
  const normalizedGlob = glob.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalizedGlob) {
    return false;
  }

  return globToRegExp(normalizedGlob).test(path);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const nextCharacter = glob[index + 1];

    if (character === "*" && nextCharacter === "*") {
      pattern += ".*";
      index += 1;
    } else if (character === "*") {
      pattern += "[^/]*";
    } else {
      pattern += escapeRegExp(character);
    }
  }

  return new RegExp(`${pattern}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function indexingErrorMessage(error: unknown): string {
  if (isIxplorerError(error)) {
    const message = error.message.trim();
    const causeMessage =
      typeof error.details?.causeMessage === "string" ? error.details.causeMessage.trim() : "";

    return causeMessage ? `${message} Cause: ${causeMessage}` : message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Indexing failed.";
}

function indexingErrorDetails(error: unknown): Record<string, unknown> | undefined {
  if (error instanceof IxplorerError) {
    return error.details;
  }

  return undefined;
}

function isSourceSnapshotIndexStore(
  indexStore: IndexStore,
): indexStore is IndexStore & SourceSnapshotIndexStore {
  return (
    "loadSourceSnapshots" in indexStore &&
    typeof indexStore.loadSourceSnapshots === "function" &&
    "updateSourceSnapshots" in indexStore &&
    typeof indexStore.updateSourceSnapshots === "function"
  );
}

function textForEmbedding(chunk: ExtractedChunk): string {
  const source = chunk.source;

  switch (source.kind) {
    case "markdown":
      return [
        `File: ${source.path}`,
        source.headingPath.length > 0 ? `Heading: ${source.headingPath.join(" > ")}` : "",
        "",
        chunk.text,
      ]
        .filter((part) => part.length > 0)
        .join("\n");
    case "pdf":
      return [`File: ${source.path}`, `Page: ${source.pageNumber}`, "", chunk.text].join("\n");
    case "document":
      return [`File: ${source.path}`, `Format: ${source.format}`, "", chunk.text].join("\n");
    case "web":
      return [`Title: ${source.title}`, `URL: ${source.url}`, "", chunk.text].join("\n");
  }
}
