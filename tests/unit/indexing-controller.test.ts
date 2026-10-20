import { IndexingController } from "@adapters/indexing";
import { AttestError } from "@core/errors";
import { IndexingService, IndexingState } from "@adapters/indexing";

import { FakeIndexingService } from "../support/indexingFakes";

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

  it("surfaces the provider response behind a failed embedding request", async () => {
    const service = new FakeIndexingService();
    service.startError = new AttestError({
      code: "EMBEDDING_UNAVAILABLE",
      message: "Provider returned HTTP 402.",
      details: { status: 402, providerMessage: "Insufficient credits." },
    });
    const controller = new IndexingController({
      createService(onProgress) {
        service.onProgress = onProgress;
        return service as unknown as IndexingService;
      },
    });

    await controller.start();

    expect(controller.getState()).toMatchObject({
      status: "error",
      errorMessage: "Provider returned HTTP 402: Insufficient credits.",
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
