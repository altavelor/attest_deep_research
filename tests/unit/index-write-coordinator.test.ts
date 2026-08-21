import type { IndexStore, IndexStoreWriteSession } from "@application/ports";
import { IndexWriteCoordinator } from "@adapters/indexing/pipeline/IndexWriteCoordinator";
import type { FileSnapshot } from "@adapters/indexing/pipeline/changeDetection";

describe("IndexWriteCoordinator", () => {
  it("reloads committed snapshots after a write session is rolled back", async () => {
    const committedSnapshots = [
      { sourcePath: "Research/a.md", modifiedTime: 1, contentHash: "committed" },
    ];
    const store = new SnapshotStore(committedSnapshots);
    const snapshots = new Map<string, FileSnapshot>();
    const coordinator = new IndexWriteCoordinator({
      indexStore: store,
      snapshots,
      embeddingBatcher: {} as never,
      progress: {} as never,
    });

    await coordinator.loadPersistedSnapshots();
    snapshots.set("Research/a.md", { modifiedTime: 2, contentHash: "rolled-back" });
    snapshots.set("Research/new.md", { modifiedTime: 1, contentHash: "rolled-back" });

    coordinator.rollback();
    await coordinator.loadPersistedSnapshots();

    expect(store.loadCalls).toBe(2);
    expect([...snapshots]).toEqual([
      ["Research/a.md", { modifiedTime: 1, contentHash: "committed" }],
    ]);
  });
});

class SnapshotStore implements IndexStore {
  loadCalls = 0;

  constructor(
    private readonly snapshots: Array<{
      sourcePath: string;
      modifiedTime: number;
      contentHash: string;
    }>,
  ) {}

  async loadSourceSnapshots() {
    this.loadCalls += 1;
    return this.snapshots;
  }

  async updateSourceSnapshots(): Promise<void> {}
  async initialize(): Promise<void> {}
  async upsert(): Promise<void> {}
  async deleteBySourcePath(): Promise<void> {}
  async clear(): Promise<void> {}
  async query(): Promise<never[]> {
    return [];
  }
  async beginWrite(): Promise<IndexStoreWriteSession> {
    throw new Error("not used");
  }
}
