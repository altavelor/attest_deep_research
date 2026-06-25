import { readdir, rm } from "fs/promises";

import { IxplorerError } from "../shared/errors";
import {
  AdjacentChunkIndexStore,
  EmbeddedChunk,
  IndexFailedSourceSnapshot,
  IndexSourceSnapshot,
  IndexStore,
  IndexStoreMetadata,
  IndexStoreWriteSession,
  KeywordSearchIndexStore,
  LanguageInventoryIndexStore,
  LanguageInventoryItem,
  RetrievedChunk,
  SourceReference,
  SourceSnapshotIndexStore,
} from "../shared/types";
import { throwRebuildRequired, isMissingFileError } from "./FileVectorIndexErrors";
import { DEFAULT_FILE_VECTOR_SHARD_COUNT } from "./FileVectorIndexFormat";
import type { FileVectorManifest } from "./FileVectorIndexFormat";
import {
  INDEX_DESCRIPTION_MAX_REPRESENTATIVE_CHUNKS,
  type IndexDescriptionSource,
} from "./IndexDescription";
import { languageInventoryFromStoredChunks } from "./FileVectorIndexLanguage";
import {
  FileVectorIndexPersistence,
  FileVectorIndexPersistenceEvent,
} from "./FileVectorIndexPersistence";
import {
  expandAdjacentFileVectorChunks,
  getAdjacentFileVectorChunks,
  queryFileVectorState,
  searchFileVectorKeywords,
} from "./FileVectorIndexQuery";
import {
  applyFailedSourceSnapshots,
  applySourceSnapshotUpdates,
  applyUpsertChunks,
  createEmptyState,
  createWriteChanges,
  FileVectorIndexState,
  removeSourcePathFromState,
} from "./FileVectorIndexState";
import type { IndexSourceReportItem } from "./types";

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
  KeywordSearchIndexStore,
  AdjacentChunkIndexStore,
  LanguageInventoryIndexStore {
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
      if (await this.hasLegacyOrUnknownFiles()) {
        throwRebuildRequired({ reason: "legacy-or-unknown-index-files", folder: this.folder });
      }

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
    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return;
    }

    const changes = createWriteChanges();
    const removed = removeSourcePathFromState(state, path, changes);

    if (!removed) {
      this.state = state;
      return;
    }

    changes.sourcesDirty = true;
    await this.persistence.persistState(state, changes);
    this.state = state;
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
    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return [];
    }

    this.state = state;
    return state.sources
      .filter((source) => source.failed !== true)
      .map(({ sourcePath, modifiedTime, contentHash, languages }) => ({
        sourcePath,
        modifiedTime,
        contentHash,
        ...(languages ? { languages } : {}),
      }));
  }

  async loadSourceReport(): Promise<IndexSourceReportItem[]> {
    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return [];
    }

    this.state = state;
    return state.sources
      .map((source) => ({
        sourcePath: source.sourcePath,
        status: source.failed === true ? ("failed" as const) : ("indexed" as const),
        modifiedTime: source.modifiedTime,
        indexedAt: source.indexedAt,
        chunkCount: source.chunkCount,
        errorMessage: source.errorMessage,
        languages: source.languages,
      }))
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
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

    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return;
    }

    applyFailedSourceSnapshots(state, snapshots);
    const changes = createWriteChanges();
    changes.sourcesDirty = true;
    await this.persistence.persistState(state, changes);
    this.state = state;
  }

  async getLanguageInventory(): Promise<LanguageInventoryItem[]> {
    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return [];
    }

    this.state = state;
    const inventory = state.manifest.languageInventory ?? [];

    if (inventory.length > 0 && inventory.some((item) => item.language !== "unknown")) {
      return [...inventory];
    }

    return languageInventoryFromStoredChunks(state);
  }

  async query(embedding: number[], limit: number): Promise<RetrievedChunk[]> {
    return queryFileVectorState(this.requireState(), embedding, limit);
  }

  async searchKeywords(
    query: string,
    options: {
      limit: number;
      includeWebResults: boolean;
      minScore?: number;
      sourceKinds?: Array<SourceReference["kind"]>;
      fileExtensions?: string[];
    },
  ): Promise<RetrievedChunk[]> {
    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return [];
    }

    this.state = state;
    return searchFileVectorKeywords(state, query, options, (relativePath) =>
      this.persistence.pathFor(relativePath),
    );
  }

  async expandAdjacentChunks(
    chunks: RetrievedChunk[],
    radius: number,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    if (radius <= 0 || chunks.length === 0 || limit <= 0) {
      return chunks.slice(0, limit);
    }

    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return chunks.slice(0, limit);
    }

    this.state = state;
    return expandAdjacentFileVectorChunks(state, chunks, radius, limit);
  }

  async getAdjacentChunks(
    source: SourceReference,
    chunkId: string,
    radius: number,
  ): Promise<RetrievedChunk[]> {
    if (radius < 0) {
      return [];
    }

    const state = this.state ?? (await this.persistence.loadExistingStateOrNull());

    if (state === null) {
      return [];
    }

    this.state = state;
    return getAdjacentFileVectorChunks(state, source, chunkId, radius);
  }

  private async hasLegacyOrUnknownFiles(): Promise<boolean> {
    let entries: string[];

    try {
      entries = await readdir(this.folder);
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }

      throw error;
    }

    return entries.some((entry) => !entry.endsWith(".tmp"));
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
