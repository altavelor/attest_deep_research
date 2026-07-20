import { IndexingProfileController, createIndexingStateFromProfile } from "@adapters/indexing";
import { IndexingService, IndexingState } from "@adapters/indexing";
import { IndexProfile } from "@adapters/indexing";

describe("IndexingProfileController", () => {
  it("builds an initial state from profile summary fields", () => {
    const state = createIndexingStateFromProfile(
      profile({
        lastIndexedAt: "2026-06-14T10:00:00.000Z",
        indexedFileCount: 7,
        indexSizeBytes: 2048,
      }),
    );

    expect(state).toMatchObject({
      status: "idle",
      lastIndexedAt: "2026-06-14T10:00:00.000Z",
      indexedFiles: 7,
      indexSizeBytes: 2048,
    });
  });

  it("blocks starting a different index while one is paused", async () => {
    const services = new Map<string, FakeIndexingService>();
    const controller = new IndexingProfileController({
      getProfile: (profileId) => profile({ id: profileId }),
      createService: (profileId) => {
        const service = new FakeIndexingService();
        services.set(profileId, service);
        return service as unknown as IndexingService;
      },
    });

    await controller.start("a");
    controller.pause("a");

    await expect(controller.start("b")).rejects.toThrow(
      "Finish or stop the current indexing run before starting another index.",
    );
    expect(services.get("b")).toBeUndefined();
  });

  it("allows starting another index after the first one completes", async () => {
    const controller = new IndexingProfileController({
      getProfile: (profileId) => profile({ id: profileId }),
      createService: () => new FakeIndexingService() as unknown as IndexingService,
    });

    await controller.start("a");
    await expect(controller.start("b")).resolves.toMatchObject({ status: "idle" });
  });
});

class FakeIndexingService {
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

  async manualReindex(): Promise<IndexingState> {
    this.state = {
      ...this.state,
      status: "idle",
      indexedFiles: 1,
      embeddedChunks: 2,
      lastIndexedAt: "2026-06-14T10:00:00.000Z",
    };
    return this.getState();
  }

  async rebuild(): Promise<IndexingState> {
    return this.manualReindex();
  }

  pause(): void {
    this.state = { ...this.state, status: "paused" };
  }

  resume(): void {
    this.state = { ...this.state, status: "idle" };
  }

  setIndexSizeBytes(indexSizeBytes?: number): void {
    this.state = { ...this.state, indexSizeBytes };
  }
}

function profile(overrides: Partial<IndexProfile> = {}): IndexProfile {
  return {
    id: "index-a",
    name: "Index A",
    mode: "wholeVault",
    indexFolder: ".ixplorer/indexes/index-a",
    includeFolders: ["/"],
    excludeGlobs: [],
    embeddingModelProfileId: "embed-a",
    refreshMode: "manual",
    shardCount: 32,
    chunkSize: 800,
    chunkOverlap: 120,
    pdfChunkSize: 1400,
    pdfChunkOverlap: 150,
    embeddingBatchSize: 32,
    keywordIndex: {
      enabled: true,
      strategy: "source-shard",
      minTokenLength: 3,
    },
    createdAt: "2026-06-14T10:00:00.000Z",
    updatedAt: "2026-06-14T10:00:00.000Z",
    ...overrides,
  };
}
