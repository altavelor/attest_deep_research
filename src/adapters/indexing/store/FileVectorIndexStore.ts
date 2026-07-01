import { rm } from "fs/promises";

import { IxplorerError } from "@core/errors";
import {
  IndexFailedSourceSnapshot,
  IndexSourceSnapshot,
  IndexStore,
  IndexStoreMetadata,
  IndexStoreWriteSession,
  SourceSnapshotIndexStore,
} from "@application/ports";
import { EmbeddedChunk, RetrievedChunk, SourceReference } from "@core/model";
import { throwRebuildRequired } from "./FileVectorIndexErrors";
import { DEFAULT_FILE_VECTOR_SHARD_COUNT } from "./FileVectorIndexFormat";
import type { FileVectorManifest } from "./FileVectorIndexFormat";
import {
  INDEX_DESCRIPTION_MAX_REPRESENTATIVE_CHUNKS,
  type IndexDescriptionSource,
} from "../inventory/IndexDescription";
import type { FileVectorPathResolver } from "./FileVectorIndexReader";
import {
  FileVectorIndexPersistence,
  FileVectorIndexPersistenceEvent,
} from "./FileVectorIndexPersistence";
import { queryFileVectorState } from "./FileVectorIndexQuery";
import {
  applyFailedSourceSnapshots,
  applySourceSnapshotUpdates,
  applyUpsertChunks,
  createEmptyState,
  createWriteChanges,
  FileVectorIndexState,
  FileVectorStateAccess,
  removeSourcePathFromState,
} from "./FileVectorIndexState";
import type { IndexSourceReportItem } from "../types";

export {
  createFileVectorManifest,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_FILE_VECTOR_SHARD_COUNT,
  DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
  DEFAULT_PDF_CHUNK_OVERLAP,
  DEFAULT_PDF_CHUNK_SIZE,
  FILE_VECTOR_INDEX_FORMAT,
  FILE_VECTOR_INDEX_SCHEMA_VERSION,
  isFileVectorManifest,
  validateFileVectorIndexFormat,
} from "./FileVectorIndexFormat";
export type {
  CreateFileVectorManifestOptions,
  FileVectorChunkRow,
  FileVectorFormatValidationInput,
  FileVectorManifest,
  FileVectorShardManifest,
  IndexProfile,
  KeywordIndexManifest,
  KeywordPostingRow,
  SourceSnapshot,
} from "./FileVectorIndexFormat";

export interface FileVectorIndexStoreOptions {
  folder: string;
  profileId?: string;
  shardCount?: number;
  now?: () => Date;
  onPerformance?: (event: FileVectorIndexStorePerformanceEvent) => void;
}

export type FileVectorIndexStorePerformanceEvent = FileVectorIndexPersistenceEvent;

const DEFAULT_PROFILE_ID = "default";

export class FileVectorIndexStore
  implements
  IndexStore,
  SourceSnapshotIndexStore,
  FileVectorPathResolver,
  FileVectorStateAccess {
  private readonly folder: string;
  private readonly profileId: string;
  private readonly shardCount: number;
  private readonly now: () => Date;
  private readonly persistence: FileVectorIndexPersistence;
  private state: FileVectorIndexState | null = null;

  constructor(options: FileVectorIndexStoreOptions) {
    this.folder = options.folder;
    this.profileId = options.profileId ?? DEFAULT_PROFILE_ID;
    this.shardCount = options.shardCount ?? DEFAULT_FILE_VECTOR_SHARD_COUNT;
    this.now = options.now ?? (() => new Date());
    this.persistence = new FileVectorIndexPersistence({
      folder: this.folder,
      now: this.now,
      createWriteId: () => createWriteId(this.now),
      onPerformance: options.onPerformance,
    });
  }

  async initialize(metadata: IndexStoreMetadata): Promise<void> {
    const manifest = await this.persistence.readManifest();

    if (manifest === null) {
      this.state = createEmptyState({
        profileId: this.profileId,
        metadata,
        shardCount: this.shardCount,
        now: this.now,
        createWriteId: () => createWriteId(this.now),
      });
      const changes = createWriteChanges();
      changes.sourcesDirty = true;
      await this.persistence.persistState(this.state, changes);
      return;
    }

    this.assertManifestMatchesStore(manifest, metadata);
    this.state = await this.persistence.loadState(manifest);
  }

  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    const writer = await this.beginWrite();
    await writer.upsert(chunks);
    await writer.commit();
  }

  async deleteBySourcePath(path: string): Promise<void> {
    await this.withState(undefined, async (state) => {
      const changes = createWriteChanges();
      if (!removeSourcePathFromState(state, path, changes)) {
        return;
      }

      changes.sourcesDirty = true;
      await this.persistence.persistState(state, changes);
    });
  }

  async beginWrite(): Promise<IndexStoreWriteSession> {
    const state = this.requireState();
    const changes = createWriteChanges();
    let closed = false;

    return {
      upsert: async (chunks) => {
        ensureWriterOpen();
        applyUpsertChunks(state, chunks, changes, this.now);
      },
      deleteBySourcePath: async (path) => {
        ensureWriterOpen();
        if (removeSourcePathFromState(state, path, changes)) {
          changes.sourcesDirty = true;
        }
      },
      updateSourceSnapshots: async (snapshots) => {
        ensureWriterOpen();
        applySourceSnapshotUpdates(state, snapshots);
        if (snapshots.length > 0) {
          changes.sourcesDirty = true;
        }
      },
      recordFailedSourceSnapshots: async (snapshots) => {
        ensureWriterOpen();
        applyFailedSourceSnapshots(state, snapshots);
        if (snapshots.length > 0) {
          changes.sourcesDirty = true;
        }
      },
      commit: async () => {
        ensureWriterOpen();
        closed = true;
        await this.persistence.persistState(state, changes);
        this.state = state;
      },
      rollback: () => {
        closed = true;
      },
    };

    function ensureWriterOpen(): void {
      if (closed) {
        throw new IxplorerError({
          code: "INDEX_UNAVAILABLE",
          message: "The file-backed index write session is already closed.",
        });
      }
    }
  }

  async clear(): Promise<void> {
    await rm(this.folder, { recursive: true, force: true });
    this.state = null;
  }

  async loadSourceSnapshots(): Promise<IndexSourceSnapshot[]> {
    return this.withState([], (state) =>
      state.sources
        .filter((source) => source.failed !== true)
        .map(({ sourcePath, modifiedTime, contentHash, languages }) => ({
          sourcePath,
          modifiedTime,
          contentHash,
          ...(languages ? { languages } : {}),
        })),
    );
  }

  async loadSourceReport(): Promise<IndexSourceReportItem[]> {
    return this.withState([], (state) =>
      state.sources
      .map((source) => ({
        sourcePath: source.sourcePath,
        status: source.failed === true ? ("failed" as const) : ("indexed" as const),
        modifiedTime: source.modifiedTime,
        indexedAt: source.indexedAt,
        chunkCount: source.chunkCount,
        errorMessage: source.errorMessage,
        languages: source.languages,
      }))
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    );
  }

  async loadIndexDescriptionSource(): Promise<IndexDescriptionSource> {
    const manifest = this.state?.manifest ?? (await this.persistence.readManifest());

    if (manifest === null) {
      throw new IxplorerError({
        code: "INDEX_UNAVAILABLE",
        message: "The committed index is unavailable for description generation.",
      });
    }

    const rows = (
      this.state
        ? [...this.state.chunksByShard.values()].flat().map((chunk) => chunk.row)
        : await this.persistence.readRepresentativeChunkRows(
          manifest,
          INDEX_DESCRIPTION_MAX_REPRESENTATIVE_CHUNKS,
        )
    ).sort((left, right) => {
      const leftPath = left.sourcePath ?? sourcePathForDescription(left.source);
      const rightPath = right.sourcePath ?? sourcePathForDescription(right.source);
      return (
        leftPath.localeCompare(rightPath) ||
        (left.chunkIndex ?? 0) - (right.chunkIndex ?? 0) ||
        left.id.localeCompare(right.id)
      );
    });
    const sourceKinds = [...new Set(rows.map((row) => row.source.kind))].sort((left, right) =>
      left.localeCompare(right),
    );
    const languageInventory = manifest.languageInventory ? [...manifest.languageInventory] : [];

    return {
      indexUpdatedAt: manifest.updatedAt,
      sourceCount: manifest.sourceCount,
      chunkCount: manifest.chunkCount,
      sourceKinds,
      languageInventory,
      representativeChunks: rows
        .slice(0, INDEX_DESCRIPTION_MAX_REPRESENTATIVE_CHUNKS)
        .map((row) => ({
          path: row.sourcePath ?? sourcePathForDescription(row.source),
          title: row.source.title,
          headingPath: row.source.kind === "markdown" ? [...row.source.headingPath] : [],
          text: row.text,
          kind: row.source.kind,
        })),
    };
  }

  async updateSourceSnapshots(snapshots: IndexSourceSnapshot[]): Promise<void> {
    if (snapshots.length === 0) {
      return;
    }

    const state = this.requireState();
    applySourceSnapshotUpdates(state, snapshots);
    const changes = createWriteChanges();
    changes.sourcesDirty = true;
    await this.persistence.persistState(state, changes);
  }

  async recordFailedSourceSnapshots(snapshots: IndexFailedSourceSnapshot[]): Promise<void> {
    if (snapshots.length === 0) {
      return;
    }

    await this.withState(undefined, async (state) => {
      applyFailedSourceSnapshots(state, snapshots);
      const changes = createWriteChanges();
      changes.sourcesDirty = true;
      await this.persistence.persistState(state, changes);
    });
  }

  async query(embedding: number[], limit: number): Promise<RetrievedChunk[]> {
    return queryFileVectorState(this.requireState(), embedding, limit);
  }

  /** Resolve an index-relative path to an absolute path; used by read collaborators. */
  pathFor(relativePath: string): string {
    return this.persistence.pathFor(relativePath);
  }

  private assertManifestMatchesStore(
    manifest: FileVectorManifest,
    metadata: IndexStoreMetadata,
  ): void {
    if (
      manifest.profileId !== this.profileId ||
      manifest.embeddingModel !== metadata.embeddingModel ||
      manifest.embeddingDimensions !== metadata.embeddingDimensions ||
      manifest.shardCount !== this.shardCount
    ) {
      throwRebuildRequired({
        reason: "metadata-mismatch",
        profileId: manifest.profileId,
        expectedProfileId: this.profileId,
        embeddingModel: manifest.embeddingModel,
        expectedEmbeddingModel: metadata.embeddingModel,
        embeddingDimensions: manifest.embeddingDimensions,
        expectedEmbeddingDimensions: metadata.embeddingDimensions,
        shardCount: manifest.shardCount,
        expectedShardCount: this.shardCount,
      });
    }
  }

  /**
   * Resolve the committed state from cache or disk, cache it, and run `run`.
   * Returns `fallback` when no committed index exists. Centralizes the
   * load-or-null + cache dance shared by every read/inventory method. Public so
   * read-only collaborators (e.g. the inventory store) can share this cache via
   * the {@link FileVectorStateAccess} port.
   */
  async withState<T>(
    fallback: T,
    run: (state: FileVectorIndexState) => T | Promise<T>,
  ): Promise<T> {
    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return fallback;
    }

    this.state = state;
    return run(state);
  }

  private requireState(): FileVectorIndexState {
    if (this.state === null) {
      throw new IxplorerError({
        code: "INDEX_UNAVAILABLE",
        message: "The file-backed index store has not been initialized.",
      });
    }

    return this.state;
  }
}

function sourcePathForDescription(source: SourceReference): string {
  return "path" in source ? source.path : source.url;
}

function createWriteId(now: () => Date): string {
  return `${now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
