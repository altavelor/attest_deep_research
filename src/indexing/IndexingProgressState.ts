import type { IndexingProgressPhase, IndexingState } from "./types";

export class IndexingProgressState {
  private state: IndexingState = createInitialState();
  private readonly onProgress?: (state: IndexingState) => void;
  private readonly now: () => Date;

  constructor(options: { onProgress?: (state: IndexingState) => void; now?: () => Date }) {
    this.onProgress = options.onProgress;
    this.now = options.now ?? (() => new Date());
  }

  getState(): IndexingState {
    return { ...this.state };
  }

  isPaused(): boolean {
    return this.state.status === "paused";
  }

  start(activeOperation: "indexing" | "rebuild"): void {
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
      lastUpdatedAt: this.timestamp(),
    };
    this.notify();
  }

  pause(): void {
    this.state = { ...this.state, status: "paused", lastUpdatedAt: this.timestamp() };
    this.notify();
  }

  resume(): void {
    if (this.state.status === "paused") {
      this.state = { ...this.state, status: "idle", lastUpdatedAt: this.timestamp() };
      this.notify();
    }
  }

  markStale(): void {
    if (this.state.status === "indexing" || this.state.status === "paused") {
      this.state = { ...this.state, isStale: true, lastUpdatedAt: this.timestamp() };
    } else {
      this.state = {
        ...this.state,
        status: "stale",
        isStale: true,
        errorMessage: undefined,
        lastUpdatedAt: this.timestamp(),
      };
    }
    this.notify();
  }

  setIndexSizeBytes(indexSizeBytes?: number): void {
    this.state = { ...this.state, indexSizeBytes };
    this.notify();
  }

  clear(): void {
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
      lastUpdatedAt: this.timestamp(),
    };
    this.notify();
  }

  setTotalFiles(totalFiles: number): void {
    this.state = {
      ...this.state,
      totalFiles,
      progress: totalFiles === 0 ? 1 : 0,
      lastUpdatedAt: this.timestamp(),
    };
    this.notify();
  }

  setPhase(phase: IndexingProgressPhase, currentFile?: string): void {
    this.state = { ...this.state, phase, currentFile, lastUpdatedAt: this.timestamp() };
    this.notify();
  }

  markFileScanned(path: string): void {
    const scannedFiles = this.state.scannedFiles + 1;
    this.state = {
      ...this.state,
      scannedFiles,
      phase: "checking",
      currentFile: path,
      progress: calculateProgress(scannedFiles, this.state.totalFiles),
      lastUpdatedAt: this.timestamp(),
    };
  }

  markSkippedFile(): void {
    this.state = { ...this.state, skippedFiles: this.state.skippedFiles + 1 };
  }

  markIndexedFile(): void {
    this.state = { ...this.state, indexedFiles: this.state.indexedFiles + 1 };
  }

  markFailedFile(): void {
    this.state = { ...this.state, failedFiles: this.state.failedFiles + 1 };
  }

  setDeferredFiles(deferredFiles: number): void {
    this.state = {
      ...this.state,
      deferredFiles,
      isStale: deferredFiles > 0,
      lastUpdatedAt: this.timestamp(),
    };
  }

  setEmbeddingProgress(input: {
    chunksTotal: number;
    chunksEmbedded: number;
    embeddingBatchesTotal: number;
    embeddingBatchesCompleted: number;
  }): void {
    this.state = {
      ...this.state,
      phase: "embedding",
      chunksTotal: input.chunksTotal,
      chunksEmbedded: input.chunksEmbedded,
      embeddingBatchesTotal: input.embeddingBatchesTotal,
      embeddingBatchesCompleted: input.embeddingBatchesCompleted,
      lastUpdatedAt: this.timestamp(),
    };
    this.notify();
  }

  addEmbeddedChunks(count: number): void {
    this.state = {
      ...this.state,
      embeddedChunks: this.state.embeddedChunks + count,
      lastUpdatedAt: this.timestamp(),
    };
    this.notify();
  }

  complete(): void {
    this.state = {
      ...this.state,
      status: this.state.deferredFiles > 0 ? "stale" : "idle",
      activeOperation: undefined,
      phase: "complete",
      currentFile: undefined,
      progress: 1,
      isStale: this.state.deferredFiles > 0,
      errorMessage: undefined,
      lastIndexedAt: this.timestamp(),
      lastUpdatedAt: this.timestamp(),
    };
    this.notify();
  }

  keepPausedAfterRun(): void {
    this.state = {
      ...this.state,
      activeOperation: undefined,
      lastUpdatedAt: this.timestamp(),
    };
    this.notify();
  }

  notify(): void {
    this.onProgress?.(this.getState());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function createInitialState(): IndexingState {
  return {
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
}

function calculateProgress(scannedFiles: number, totalFiles: number): number {
  if (totalFiles <= 0) {
    return 0;
  }

  return Math.min(1, scannedFiles / totalFiles);
}
