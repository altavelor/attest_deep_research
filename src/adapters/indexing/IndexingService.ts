import { isAttestError, AttestError } from "@core/errors";
import { VaultFileSummary } from "@application/ports";
import { positiveIntegerOrDefault, scheduleTimeout } from "@shared";
import type { IndexFailedSourceSnapshot } from "@application/ports";
import type { ExtractedChunk } from "@core/model";
import type { FileSnapshot } from "./pipeline/changeDetection";
import { EmbeddingBatcher } from "./pipeline/EmbeddingBatcher";
import { FileProcessor } from "./pipeline/FileProcessor";
import { REQUIRED_INDEX_VERSION } from "./store/FileVectorImageManifest";
import { IndexingProgressState } from "./controller/IndexingProgressState";
import { IndexWriteCoordinator } from "./pipeline/IndexWriteCoordinator";
import type {
  IndexedFileResult,
  IndexingServiceOptions,
  IndexingState,
  PendingIndexedFile,
} from "./types";

export type {
  IndexedFileResult,
  IndexingFileLogEvent,
  IndexingFileLogReason,
  IndexingLogger,
  IndexingPerformanceLogEvent,
  IndexingProgressPhase,
  IndexingServiceOptions,
  IndexingState,
  IndexingStatus,
  IndexSourceReportItem,
  PendingIndexedFile,
} from "./types";

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_YIELD_EVERY_FILES = 25;

export class IndexingService {
  private readonly batchSize: number;
  private readonly yieldEveryFiles: number;
  private readonly maxChangedFilesPerRun?: number;
  private readonly yieldToEventLoop: () => Promise<void>;
  private readonly now: () => Date;
  private readonly snapshots = new Map<string, FileSnapshot>();
  private readonly progress: IndexingProgressState;
  private collectingDocumentImages = false;
  private readonly fileProcessor: FileProcessor;
  private readonly writer: IndexWriteCoordinator;
  private readonly files: IndexingServiceOptions["files"];
  private readonly logger?: IndexingServiceOptions["logger"];

  constructor(options: IndexingServiceOptions) {
    this.files = options.files;
    this.logger = options.logger;
    this.batchSize = positiveIntegerOrDefault(options.batchSize, DEFAULT_BATCH_SIZE);
    this.yieldEveryFiles = positiveIntegerOrDefault(
      options.yieldEveryFiles,
      DEFAULT_YIELD_EVERY_FILES,
    );
    this.maxChangedFilesPerRun = options.maxChangedFilesPerRun;
    this.yieldToEventLoop = options.yieldToEventLoop ?? defaultYieldToEventLoop;
    this.now = options.now ?? (() => new Date());
    this.progress = new IndexingProgressState({
      onProgress: options.onProgress,
      now: this.now,
    });

    const embeddingBatcher = new EmbeddingBatcher({
      embeddings: options.embeddings,
      embeddingModel: options.embeddingModel,
      batchSize: this.batchSize,
      indexStore: options.indexStore,
      progress: this.progress,
      yieldToEventLoop: this.yieldToEventLoop,
      logger: options.logger,
    });
    this.writer = new IndexWriteCoordinator({
      indexStore: options.indexStore,
      snapshots: this.snapshots,
      embeddingBatcher,
      progress: this.progress,
      logger: options.logger,
    });
    this.fileProcessor = new FileProcessor({
      files: options.files,
      extractors: options.extractors,
      includeFolders: options.includeFolders,
      excludeGlobs: options.excludeGlobs,
      snapshots: this.snapshots,
      progress: this.progress,
      logger: options.logger,
      ...(options.resolveLinkedImagePath
        ? { resolveLinkedImagePath: options.resolveLinkedImagePath }
        : {}),
      ...(options.maxFileSizeBytesByExtension
        ? { maxFileSizeBytesByExtension: options.maxFileSizeBytesByExtension }
        : {}),
    });
  }

  getState(): IndexingState {
    return this.progress.getState();
  }

  pause(): void {
    this.progress.pause();
  }

  resume(): void {
    this.progress.resume();
  }

  markStale(): void {
    this.progress.markStale();
  }

  setIndexSizeBytes(indexSizeBytes?: number): void {
    this.progress.setIndexSizeBytes(indexSizeBytes);
  }

  async clear(): Promise<void> {
    await this.writer.clear();
    this.progress.clear();
  }

  async rebuild(): Promise<IndexingState> {
    await this.writer.clear();
    if (this.progress.isPaused()) {
      this.progress.resume();
    }
    this.collectingDocumentImages = true;
    try {
      return await this.manualReindex("rebuild");
    } finally {
      this.collectingDocumentImages = false;
    }
  }

  async manualReindex(
    activeOperation: "indexing" | "rebuild" = "indexing",
  ): Promise<IndexingState> {
    if (this.progress.isPaused()) {
      return this.getState();
    }

    this.progress.start(activeOperation);

    const files = (await this.files.listFiles()).filter((file) =>
      this.fileProcessor.canProcessPath(file.path),
    );
    await this.writer.loadPersistedSnapshots();
    const indexWasEmpty = this.snapshots.size === 0;
    this.progress.setTotalFiles(files.length);
    await this.writer.begin();
    this.writer.beginImageManifest(this.collectingDocumentImages ? "replace" : "merge");

    const pendingChunks: ExtractedChunk[] = [];
    const pendingIndexedFiles: PendingIndexedFile[] = [];
    let imageManifestWritten = false;

    try {
      await this.processFiles(files, pendingChunks, pendingIndexedFiles);

      if (!this.progress.isPaused()) {
        await this.writer.flushPending({
          chunks: pendingChunks,
          indexedFiles: pendingIndexedFiles,
        });
        if (this.collectingDocumentImages && !this.isCompleteRun()) {
          this.writer.discardImageManifest();
        } else if (!this.collectingDocumentImages && indexWasEmpty && this.isCompleteRun()) {
          this.writer.promoteImageManifestToReplace();
        }
        this.progress.setPhase("writing");
        imageManifestWritten = await this.writer.commit();
      } else {
        this.writer.rollback();
      }
    } catch (error) {
      this.writer.rollback();
      throw error;
    }

    if (this.progress.isPaused()) {
      this.progress.keepPausedAfterRun();
    } else {
      if (imageManifestWritten) {
        this.progress.setIndexVersion(REQUIRED_INDEX_VERSION);
      }
      this.progress.complete();
    }

    return this.getState();
  }

  /**
   * True when the run covered every file. A rebuild that skipped a failed
   * document or deferred files produced an incomplete image manifest, so
   * neither the manifest nor the index version may be persisted.
   */
  private isCompleteRun(): boolean {
    const state = this.getState();
    return state.failedFiles === 0 && state.deferredFiles === 0;
  }

  private async processFiles(
    files: VaultFileSummary[],
    pendingChunks: ExtractedChunk[],
    pendingIndexedFiles: PendingIndexedFile[],
  ): Promise<void> {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];

      if (this.progress.isPaused()) {
        break;
      }

      const result = await this.processFileSafely(file);
      this.progress.markFileScanned(file.path);
      if (result.documentImages) {
        this.writer.recordDocumentImages(file.path, result.documentImages);
      }
      this.updateCountersAndPending(file, result, pendingChunks, pendingIndexedFiles);

      await this.writer.flushPending({
        chunks: pendingChunks,
        indexedFiles: pendingIndexedFiles,
      });

      this.progress.notify();

      if (this.hasReachedChangedFileCap()) {
        this.progress.setDeferredFiles(files.length - fileIndex - 1);
        break;
      }

      if (this.shouldYieldAfterFile()) {
        await this.yieldToEventLoop();
      }
    }
  }

  private async processFileSafely(file: VaultFileSummary): Promise<IndexedFileResult> {
    try {
      return await this.fileProcessor.process(file);
    } catch (error) {
      const errorMessage = indexingErrorMessage(error);
      const failedSnapshot: IndexFailedSourceSnapshot = {
        sourcePath: file.path,
        modifiedTime: file.modifiedTime,
        errorMessage,
        indexedAt: this.now().toISOString(),
      };
      await this.writer.persistFailedSourceSnapshots([failedSnapshot]);
      this.progress.markFailedFile();
      this.fileProcessorLogFailure(file, errorMessage, error);
      return { indexed: false, skipped: false, chunks: [] };
    }
  }

  private updateCountersAndPending(
    file: VaultFileSummary,
    result: IndexedFileResult,
    pendingChunks: ExtractedChunk[],
    pendingIndexedFiles: PendingIndexedFile[],
  ): void {
    if (result.skipped) {
      this.progress.markSkippedFile();
    }

    if (result.indexed && result.contentHash) {
      this.progress.markIndexedFile();
      pendingIndexedFiles.push(toPendingIndexedFile(file, result));
      pendingChunks.push(...result.chunks);
    }

    if (!result.indexed && result.persistSnapshot && result.contentHash) {
      pendingIndexedFiles.push(toPendingIndexedFile(file, result));
    }
  }

  private fileProcessorLogFailure(
    file: VaultFileSummary,
    errorMessage: string,
    error: unknown,
  ): void {
    this.logger?.logIndexingFile({
      path: file.path,
      outcome: "failed",
      reason: "extraction-failed",
      modifiedTime: file.modifiedTime,
      errorMessage,
      errorDetails: indexingErrorDetails(error),
    });
  }

  private shouldYieldAfterFile(): boolean {
    return (
      this.getState().scannedFiles > 0 && this.getState().scannedFiles % this.yieldEveryFiles === 0
    );
  }

  private hasReachedChangedFileCap(): boolean {
    if (this.maxChangedFilesPerRun === undefined || this.maxChangedFilesPerRun <= 0) {
      return false;
    }

    const state = this.getState();
    return state.indexedFiles + state.failedFiles >= this.maxChangedFilesPerRun;
  }
}

function toPendingIndexedFile(
  file: VaultFileSummary,
  result: IndexedFileResult,
): PendingIndexedFile {
  return {
    ...file,
    contentHash: result.contentHash ?? "",
    chunkCount: result.chunks.length,
    languages: result.languages,
  };
}

function defaultYieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => scheduleTimeout(resolve, 0));
}

function indexingErrorMessage(error: unknown): string {
  if (isAttestError(error)) {
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
  if (error instanceof AttestError) {
    return error.details;
  }

  return undefined;
}
