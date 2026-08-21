import { IndexingController } from "@adapters/indexing";
import { IndexingService, IndexingState } from "@adapters/indexing";

describe("IndexingController", () => {
  it("routes lifecycle actions through one service and refreshes measured size", async () => {
    const service = new FakeIndexingService();
    const states: IndexingState[] = [];
    const controller = new IndexingController({
      createService(onProgress) {
        service.onProgress = onProgress;
        return service as unknown as IndexingService;
      },
      measureIndexSize: async () => 42,
    });
    controller.subscribe((state) => states.push(state));

    await controller.start();
    controller.pause();
    await controller.resume();
    await controller.rebuild();
    controller.markStale();

    expect(service.startCalls).toBe(3);
    expect(service.rebuildCalls).toBe(1);
    expect(controller.getState()).toMatchObject({
      status: "stale",
      indexSizeBytes: 42,
      isStale: true,
    });
    expect(states.some((state) => state.status === "paused")).toBe(true);
  });

  it("moves to error state when indexing fails", async () => {
    const service = new FakeIndexingService();
    service.failNextStart = true;
    const errors: unknown[] = [];
    const controller = new IndexingController({
      createService(onProgress) {
        service.onProgress = onProgress;
        return service as unknown as IndexingService;
      },
      onError: (error) => errors.push(error),
    });

    await controller.start();

    expect(errors).toHaveLength(1);
    expect(controller.getState()).toMatchObject({
      status: "error",
      activeOperation: undefined,
      errorMessage: "Embedding provider unavailable",
    });
  });

  it("keeps an in-flight run paused until it reaches its rollback boundary before resuming", async () => {
    const service = new DelayedIndexingService();
    const controller = new IndexingController({
      createService(onProgress) {
        service.onProgress = onProgress;
        return service as unknown as IndexingService;
      },
    });

    const firstRun = controller.start();
    await service.started;
    controller.pause();

    const resumedRun = controller.resume();
    await Promise.resolve();
    expect(service.resumeCalls).toBe(0);
    expect(service.getState().status).toBe("paused");

    service.finishFirstRun();
    await firstRun;
    await resumedRun;

    expect(service.resumeCalls).toBe(1);
    expect(service.startCalls).toBe(2);
  });
});

class FakeIndexingService {
  onProgress: ((state: IndexingState) => void) | null = null;
  startCalls = 0;
  rebuildCalls = 0;
  failNextStart = false;
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

  getState(): IndexingState {
    return { ...this.state };
  }

  protected setStatus(status: IndexingState["status"]): void {
    this.state = { ...this.state, status };
    this.onProgress?.(this.getState());
  }

  async manualReindex(): Promise<IndexingState> {
    this.startCalls += 1;
    this.state = {
      ...this.state,
      status: "indexing",
      activeOperation: "indexing",
      scannedFiles: 1,
      totalFiles: 2,
      progress: 0.5,
    };
    this.onProgress?.(this.getState());

    if (this.failNextStart) {
      this.failNextStart = false;
      throw new Error("Embedding provider unavailable");
    }

    this.state = {
      ...this.state,
      status: "idle",
      activeOperation: undefined,
      scannedFiles: 1,
      totalFiles: 1,
      progress: 1,
      indexedFiles: 1,
      isStale: false,
    };
    this.onProgress?.(this.getState());
    return this.getState();
  }

  pause(): void {
    this.state = { ...this.state, status: "paused" };
    this.onProgress?.(this.getState());
  }

  resume(): void {
    this.state = { ...this.state, status: "idle" };
    this.onProgress?.(this.getState());
  }

  async rebuild(): Promise<IndexingState> {
    this.rebuildCalls += 1;
    return this.manualReindex();
  }

  markStale(): void {
    this.state = { ...this.state, status: "stale", isStale: true };
    this.onProgress?.(this.getState());
  }

  setIndexSizeBytes(indexSizeBytes?: number): void {
    this.state = { ...this.state, indexSizeBytes };
    this.onProgress?.(this.getState());
  }
}

class DelayedIndexingService extends FakeIndexingService {
  readonly started: Promise<void>;
  resumeCalls = 0;
  private resolveStarted!: () => void;
  private resolveFirstRun!: () => void;
  private firstRun = true;

  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  override async manualReindex(): Promise<IndexingState> {
    if (!this.firstRun) return super.manualReindex();
    this.firstRun = false;
    this.startCalls += 1;
    this.setStatus("indexing");
    this.resolveStarted();
    await new Promise<void>((resolve) => {
      this.resolveFirstRun = resolve;
    });
    return this.getState();
  }

  override resume(): void {
    this.resumeCalls += 1;
    super.resume();
  }

  finishFirstRun(): void {
    this.resolveFirstRun();
  }
}
