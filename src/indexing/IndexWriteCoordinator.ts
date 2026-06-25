import type {
  ExtractedChunk,
  IndexFailedSourceSnapshot,
  IndexStore,
  IndexStoreWriteSession,
  SourceSnapshotIndexStore,
} from "../shared/types";
import { updateSnapshot } from "./changeDetection";
import type { FileSnapshot } from "./changeDetection";
import { EmbeddingBatcher } from "./EmbeddingBatcher";
import { IndexingProgressState } from "./IndexingProgressState";
import type { IndexingLogger, PendingIndexedFile } from "./types";

export class IndexWriteCoordinator {
  private readonly indexStore: IndexStore;
  private readonly snapshots: Map<string, FileSnapshot>;
  private readonly embeddingBatcher: EmbeddingBatcher;
  private readonly progress: IndexingProgressState;
  private readonly logger?: IndexingLogger;
  private snapshotsLoaded = false;
  private writer: IndexStoreWriteSession | undefined;

  constructor(options: {
    indexStore: IndexStore;
    snapshots: Map<string, FileSnapshot>;
    embeddingBatcher: EmbeddingBatcher;
    progress: IndexingProgressState;
    logger?: IndexingLogger;
  }) {
    this.indexStore = options.indexStore;
    this.snapshots = options.snapshots;
    this.embeddingBatcher = options.embeddingBatcher;
    this.progress = options.progress;
    this.logger = options.logger;
  }

  async clear(): Promise<void> {
    await this.indexStore.clear();
    this.snapshots.clear();
    this.snapshotsLoaded = false;
  }

  async begin(): Promise<void> {
    this.writer = undefined;
  }

  async commit(): Promise<void> {
    await this.writer?.commit();
    this.writer = undefined;
  }

  rollback(): void {
    this.writer?.rollback();
    this.writer = undefined;
  }

  async loadPersistedSnapshots(): Promise<void> {
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

  async flushPending(input: {
    chunks: ExtractedChunk[];
    indexedFiles: PendingIndexedFile[];
  }): Promise<void> {
    const startedAt = Date.now();
    if (input.chunks.length === 0 && input.indexedFiles.length === 0) {
      return;
    }

    const sourcePathsToReplace = input.indexedFiles.map((file) => file.path);
    const embeddedChunks =
      input.chunks.length > 0
        ? await this.embeddingBatcher.embedAndStoreChunks({
          chunks: input.chunks,
          sourcePathsToReplace,
          getWriter: () => this.getWriter(),
        })
        : [];

    if (input.chunks.length === 0) {
      for (const sourcePath of sourcePathsToReplace) {
        await this.indexStore.deleteBySourcePath(sourcePath);
      }
    }

    for (const file of input.indexedFiles) {
      updateSnapshot(this.snapshots, file);
      if (file.chunkCount > 0) {
        this.logger?.logIndexingFile({
          path: file.path,
          outcome: "indexed",
          reason: "indexed",
          modifiedTime: file.modifiedTime,
          contentHash: file.contentHash,
          chunkCount: file.chunkCount,
        });
      }
    }
    await this.persistSourceSnapshots(input.indexedFiles);

    input.chunks.length = 0;
    input.indexedFiles.length = 0;
    this.progress.addEmbeddedChunks(embeddedChunks.length);
    this.logger?.logIndexingPerformance?.({
      phase: "writing",
      durationMs: Date.now() - startedAt,
      chunkCount: embeddedChunks.length,
    });
  }

  async persistFailedSourceSnapshots(snapshots: IndexFailedSourceSnapshot[]): Promise<void> {
    if (
      !isSourceSnapshotIndexStore(this.indexStore) ||
      !this.indexStore.recordFailedSourceSnapshots
    ) {
      return;
    }

    const writer = this.writer;
    if (writer?.recordFailedSourceSnapshots) {
      await writer.recordFailedSourceSnapshots(snapshots);
    } else {
      await this.indexStore.recordFailedSourceSnapshots(snapshots);
    }
  }

  private async getWriter(): Promise<IndexStoreWriteSession | undefined> {
    if (!supportsWriteSession(this.indexStore)) {
      return undefined;
    }

    this.writer ??= await this.indexStore.beginWrite();
    return this.writer;
  }

  private async persistSourceSnapshots(indexedFiles: PendingIndexedFile[]): Promise<void> {
    if (!isSourceSnapshotIndexStore(this.indexStore) || indexedFiles.length === 0) {
      return;
    }

    const snapshots = indexedFiles.map((file) => ({
      sourcePath: file.path,
      modifiedTime: file.modifiedTime,
      contentHash: file.contentHash,
      languages: file.languages,
    }));

    if (this.writer?.updateSourceSnapshots) {
      await this.writer.updateSourceSnapshots(snapshots);
    } else {
      await this.indexStore.updateSourceSnapshots(snapshots);
    }
  }
}

function supportsWriteSession(
  store: IndexStore,
): store is IndexStore & { beginWrite(): Promise<IndexStoreWriteSession> } {
  return typeof store.beginWrite === "function";
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
