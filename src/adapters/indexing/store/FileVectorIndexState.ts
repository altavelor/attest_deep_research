import { IndexFailedSourceSnapshot, IndexSourceSnapshot, IndexStoreMetadata } from "../../../application/ports/indexing";
import { EmbeddedChunk } from "@core/model";
import { shardIdForSourcePath } from "../inventory/sourcePathShard";
import { createFileVectorManifest } from "./FileVectorIndexFormat";
import type { FileVectorChunkRow, FileVectorManifest, SourceSnapshot } from "./FileVectorIndexFormat";
import { throwRebuildRequired } from "./FileVectorIndexErrors";
import { normalizeVector, sourcePathFromReference } from "./FileVectorIndexVector";

export interface StoredChunk {
  row: FileVectorChunkRow;
  embedding: number[];
}

export interface FileVectorIndexState {
  manifest: FileVectorManifest;
  sources: SourceSnapshot[];
  chunksByShard: Map<string, StoredChunk[]>;
}

/**
 * Narrow read port over the committed state: resolve it (from cache or disk),
 * run `run`, or return `fallback` when no committed index exists. Lets read-only
 * collaborators (inventory) share the store's cache without depending on the store.
 */
export interface FileVectorStateAccess {
  withState<T>(fallback: T, run: (state: FileVectorIndexState) => T | Promise<T>): Promise<T>;
}

export interface FileVectorIndexWriteChanges {
  dirtyShardIds: Set<string>;
  dirtySourcePaths: Set<string>;
  replacedChunkIds: Set<string>;
  sourcesDirty: boolean;
}

export function createEmptyState(options: {
  profileId: string;
  metadata: IndexStoreMetadata;
  shardCount: number;
  now: () => Date;
  createWriteId: () => string;
}): FileVectorIndexState {
  const manifest = createFileVectorManifest({
    profileId: options.profileId,
    embeddingModel: options.metadata.embeddingModel,
    embeddingDimensions: options.metadata.embeddingDimensions,
    updatedAt: options.now().toISOString(),
    writeId: options.createWriteId(),
    shardCount: options.shardCount,
  });

  return {
    manifest,
    sources: [],
    chunksByShard: new Map(manifest.shards.map((shard) => [shard.id, []])),
  };
}

export function createWriteChanges(): FileVectorIndexWriteChanges {
  return {
    dirtyShardIds: new Set(),
    dirtySourcePaths: new Set(),
    replacedChunkIds: new Set(),
    sourcesDirty: false,
  };
}

export function applyUpsertChunks(
  state: FileVectorIndexState,
  chunks: EmbeddedChunk[],
  changes: FileVectorIndexWriteChanges,
  now: () => Date,
): void {
  if (chunks.length === 0) {
    return;
  }

  const dimensions = state.manifest.embeddingDimensions;
  const byId = new Map<string, EmbeddedChunk>();

  for (const chunk of chunks) {
    if (chunk.embedding.length !== dimensions) {
      throwRebuildRequired({
        reason: "embedding-dimensions-mismatch",
        chunkId: chunk.id,
        expected: dimensions,
        actual: chunk.embedding.length,
      });
    }

    byId.set(chunk.id, chunk);
  }

  removeChunkIdsFromState(state, new Set(byId.keys()), changes);
  const chunkIndexBySourcePath = nextChunkIndexBySourcePath(state);

  for (const chunk of byId.values()) {
    const sourcePath = sourcePathFromReference(chunk.source);
    const shardId = shardIdForSourcePath(sourcePath, state.manifest.shardCount);
    const chunkIndex = chunkIndexBySourcePath.get(sourcePath) ?? 0;
    chunkIndexBySourcePath.set(sourcePath, chunkIndex + 1);
    const storedChunk: StoredChunk = {
      row: {
        id: chunk.id,
        source: chunk.source,
        sourcePath,
        text: chunk.text,
        contentHash: chunk.contentHash,
        embeddingModel: chunk.embeddingModel,
        vectorOffset: 0,
        vectorLength: dimensions,
        chunkIndex,
      },
      embedding: normalizeVector(chunk.embedding),
    };
    const shardChunks = state.chunksByShard.get(shardId) ?? [];
    shardChunks.push(storedChunk);
    state.chunksByShard.set(shardId, shardChunks);
    changes.dirtyShardIds.add(shardId);
    changes.dirtySourcePaths.add(sourcePath);
    changes.replacedChunkIds.add(chunk.id);
  }

  refreshSources(state, now);
  changes.sourcesDirty = true;
}

export function applySourceSnapshotUpdates(
  state: FileVectorIndexState,
  snapshots: IndexSourceSnapshot[],
): void {
  if (snapshots.length === 0) {
    return;
  }

  const bySourcePath = new Map(snapshots.map((snapshot) => [snapshot.sourcePath, snapshot]));

  state.sources = state.sources.map((source) => {
    const snapshot = bySourcePath.get(source.sourcePath);

    if (!snapshot) {
      return source;
    }

    return {
      ...source,
      modifiedTime: snapshot.modifiedTime,
      contentHash: snapshot.contentHash,
      ...(snapshot.languages ? { languages: snapshot.languages } : {}),
    };
  });
}

export function applyFailedSourceSnapshots(
  state: FileVectorIndexState,
  snapshots: IndexFailedSourceSnapshot[],
): void {
  if (snapshots.length === 0) {
    return;
  }

  const bySourcePath = new Map(state.sources.map((source) => [source.sourcePath, source]));

  for (const snapshot of snapshots) {
    bySourcePath.set(snapshot.sourcePath, {
      sourcePath: snapshot.sourcePath,
      modifiedTime: snapshot.modifiedTime,
      contentHash: "",
      indexedAt: snapshot.indexedAt,
      shardId: shardIdForSourcePath(snapshot.sourcePath, state.manifest.shardCount),
      chunkCount: 0,
      failed: true,
      errorMessage: snapshot.errorMessage,
    });
  }

  state.sources = Array.from(bySourcePath.values()).sort((left, right) =>
    left.sourcePath.localeCompare(right.sourcePath),
  );
}

export function removeSourcePathFromState(
  state: FileVectorIndexState,
  sourcePath: string,
  changes?: FileVectorIndexWriteChanges,
): boolean {
  let removed = false;

  for (const [shardId, chunks] of state.chunksByShard.entries()) {
    const retained = chunks.filter((chunk) => chunk.row.sourcePath !== sourcePath);

    if (retained.length !== chunks.length) {
      removed = true;
      changes?.dirtyShardIds.add(shardId);
      for (const chunk of chunks) {
        if (chunk.row.sourcePath === sourcePath) {
          changes?.replacedChunkIds.add(chunk.row.id);
        }
      }
      state.chunksByShard.set(shardId, retained);
    }
  }

  if (removed) {
    state.sources = state.sources.filter((source) => source.sourcePath !== sourcePath);
  }

  return removed;
}

function removeChunkIdsFromState(
  state: FileVectorIndexState,
  chunkIds: Set<string>,
  changes?: FileVectorIndexWriteChanges,
): boolean {
  let removed = false;

  for (const [shardId, chunks] of state.chunksByShard.entries()) {
    const retained = chunks.filter((chunk) => !chunkIds.has(chunk.row.id));

    if (retained.length !== chunks.length) {
      removed = true;
      changes?.dirtyShardIds.add(shardId);
      for (const chunk of chunks) {
        if (chunkIds.has(chunk.row.id)) {
          changes?.dirtySourcePaths.add(
            chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source),
          );
          changes?.replacedChunkIds.add(chunk.row.id);
        }
      }
      state.chunksByShard.set(shardId, retained);
    }
  }

  return removed;
}

function nextChunkIndexBySourcePath(state: FileVectorIndexState): Map<string, number> {
  const bySourcePath = new Map<string, number>();

  for (const chunks of state.chunksByShard.values()) {
    for (const chunk of chunks) {
      const sourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
      const nextIndex = (chunk.row.chunkIndex ?? 0) + 1;
      bySourcePath.set(sourcePath, Math.max(bySourcePath.get(sourcePath) ?? 0, nextIndex));
    }
  }

  return bySourcePath;
}

function refreshSources(state: FileVectorIndexState, now: () => Date): void {
  const bySourcePath = new Map<string, StoredChunk[]>();
  const existingSources = new Map(state.sources.map((source) => [source.sourcePath, source]));

  for (const chunks of state.chunksByShard.values()) {
    for (const chunk of chunks) {
      const sourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
      const sourceChunks = bySourcePath.get(sourcePath) ?? [];
      sourceChunks.push(chunk);
      bySourcePath.set(sourcePath, sourceChunks);
    }
  }

  state.sources = Array.from(bySourcePath.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourcePath, chunks]) => {
      const existing = existingSources.get(sourcePath);

      return {
        sourcePath,
        modifiedTime: existing?.modifiedTime ?? 0,
        contentHash: chunks[0]?.row.contentHash ?? "",
        indexedAt: existing?.indexedAt ?? now().toISOString(),
        shardId: shardIdForSourcePath(sourcePath, state.manifest.shardCount),
        chunkCount: chunks.length,
        ...(existing?.languages ? { languages: existing.languages } : {}),
      };
    });
}
