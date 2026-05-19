import { IndexingService, IndexingState } from "./IndexingService";

export interface IndexingControllerOptions {
  createService(onProgress: IndexingStateListener): IndexingService;
  measureIndexSize?: () => Promise<number | null>;
  onError?: (error: unknown) => void;
}

export type IndexingStateListener = (state: IndexingState) => void;

export class IndexingController {
  private readonly createService: (onProgress: IndexingStateListener) => IndexingService;
  private readonly measureIndexSize?: () => Promise<number | null>;
  private readonly onError?: (error: unknown) => void;
  private readonly listeners = new Set<IndexingStateListener>();
  private service: IndexingService | null = null;
  private recreateServiceOnNextRun = false;
  private state: IndexingState = {
    status: "idle",
    scannedFiles: 0,
    totalFiles: 0,
    progress: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    embeddedChunks: 0,
    isStale: false,
  };
  private inFlight: Promise<IndexingState> | null = null;

  constructor(options: IndexingControllerOptions) {
    this.createService = options.createService;
    this.measureIndexSize = options.measureIndexSize;
    this.onError = options.onError;
  }

  getState(): IndexingState {
    return { ...this.state };
  }

  subscribe(listener: IndexingStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());

    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<IndexingState> {
    return this.runExclusive(() => this.getService().manualReindex());
  }

  pause(): void {
    this.getService().pause();
    this.updateState(this.getService().getState());
  }

  async resume(): Promise<IndexingState> {
    const service = this.getService();
    service.resume();

    if (this.inFlight) {
      await this.inFlight.catch(() => undefined);
    }

    return this.start();
  }

  async rebuild(): Promise<IndexingState> {
    return this.runExclusive(() => this.getService().rebuild());
  }

  markStale(): void {
    if (this.service) {
      this.service.markStale();
      this.updateState(this.service.getState());
    } else {
      this.updateState({
        ...this.state,
        status: "stale",
        isStale: true,
        lastUpdatedAt: new Date().toISOString(),
      });
    }

    this.recreateServiceOnNextRun = true;
    if (!this.inFlight) {
      this.service = null;
    }
  }

  async refreshIndexSize(): Promise<void> {
    if (!this.measureIndexSize) {
      return;
    }

    const size = await this.measureIndexSize();
    const service = this.getService();
    service.setIndexSizeBytes(size ?? undefined);
    this.updateState(service.getState());
  }

  private getService(): IndexingService {
    if (!this.inFlight && this.recreateServiceOnNextRun) {
      this.service = null;
      this.recreateServiceOnNextRun = false;
    }

    if (!this.service) {
      this.service = this.createService((state) => this.updateState(state));
      this.updateState(this.service.getState());
    }

    return this.service;
  }

  private async runExclusive(action: () => Promise<IndexingState>): Promise<IndexingState> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const run = action()
      .then(async (state) => {
        this.updateState(state);
        await this.refreshIndexSize();
        return this.getState();
      })
      .catch((error) => {
        this.onError?.(error);
        this.updateState({
          ...this.getService().getState(),
          status: "error",
          activeOperation: undefined,
          errorMessage: indexingErrorMessage(error),
          lastUpdatedAt: new Date().toISOString(),
        });
        return this.getState();
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = run;
    return run;
  }

  private updateState(state: IndexingState): void {
    this.state = { ...state };

    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }
}

function indexingErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Indexing failed.";
}
