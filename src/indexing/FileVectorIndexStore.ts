import { readdir, rm } from "fs/promises";
import { join } from "path";

import { IxplorerError } from "../shared/errors";
import {
  EmbeddedChunk,
  AdjacentChunkIndexStore,
  IndexFailedSourceSnapshot,
  IndexStore,
  IndexStoreWriteSession,
  IndexStoreMetadata,
  IndexSourceSnapshot,
  KeywordSearchIndexStore,
  RetrievedChunk,
  SourceReference,
  SourceSnapshotIndexStore,
} from "../shared/types";
import { chunkMatchesRetrievalOptions } from "../retrieval/retrievalFilters";
import {
  AtomicIndexFile,
  atomicWriteIndexFiles,
  readBinaryIndexFile,
  readJsonIndexFile,
  readJsonlIndexFile,
} from "./fileIndexFiles";
import {
  buildKeywordPostingRows,
  countIndexedKeywordChunks,
  mergeKeywordPostingRows,
  rankKeywordPostings,
} from "./LightweightKeywordIndex";
import { shardIdForSourcePath } from "./sourcePathShard";

export const FILE_VECTOR_INDEX_SCHEMA_VERSION = 2;
export const FILE_VECTOR_INDEX_FORMAT = "ixplorer-file-vector-index";
export const DEFAULT_FILE_VECTOR_SHARD_COUNT = 32;
export const DEFAULT_KEYWORD_MIN_TOKEN_LENGTH = 3;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 32;
export const DEFAULT_PDF_CHUNK_SIZE = 1400;
export const DEFAULT_PDF_CHUNK_OVERLAP = 150;
export const VECTOR_FLOAT_BYTES = 4;

export interface IndexProfile {
  id: string;
  name: string;
  indexFolder: string;
  includeFolders: string[];
  excludeGlobs: string[];
  embeddingModel: string;
  embeddingProviderBaseUrl: string;
  sourceKinds?: Array<SourceReference["kind"]>;
  refreshMode: "manual" | "onStartup" | "onVaultChange";
  shardCount: typeof DEFAULT_FILE_VECTOR_SHARD_COUNT;
  chunkSize: number;
  chunkOverlap: number;
  pdfChunkSize: number;
  pdfChunkOverlap: number;
  embeddingBatchSize: number;
  keywordIndex: {
    enabled: boolean;
    strategy: "source-shard";
    minTokenLength: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface FileVectorManifest {
  schemaVersion: typeof FILE_VECTOR_INDEX_SCHEMA_VERSION;
  format: typeof FILE_VECTOR_INDEX_FORMAT;
  profileId: string;
  embeddingModel: string;
  embeddingDimensions: number;
  vectorEncoding: "float32-le-normalized";
  sourceSnapshotFile: "sources.jsonl";
  shardCount: number;
  shards: FileVectorShardManifest[];
  keywordIndex: KeywordIndexManifest;
  chunkCount: number;
  sourceCount: number;
  updatedAt: string;
  writeId: string;
}

export interface FileVectorShardManifest {
  id: string;
  chunkMetadataFile: string;
  vectorFile: string;
  chunkCount: number;
  vectorByteLength: number;
}

export interface FileVectorChunkRow {
  id: string;
  source: SourceReference;
  sourcePath?: string;
  text: string;
  contentHash: string;
  embeddingModel: string;
  vectorOffset: number;
  vectorLength: number;
  chunkIndex?: number;
}

export interface SourceSnapshot {
  sourcePath: string;
  modifiedTime: number;
  contentHash: string;
  indexedAt: string;
  shardId: string;
  chunkCount: number;
  failed?: boolean;
  errorMessage?: string;
}

export interface KeywordIndexManifest {
  schemaVersion: typeof FILE_VECTOR_INDEX_SCHEMA_VERSION;
  tokenizer: "simple-lowercase";
  strategy: "source-shard";
  minTokenLength: number;
  files: string[];
  indexedChunkCount: number;
}

export interface KeywordPostingRow {
  term: string;
  postings: Array<{
    chunkId: string;
    frequency: number;
  }>;
}

export interface CreateFileVectorManifestOptions {
  profileId: string;
  embeddingModel: string;
  embeddingDimensions: number;
  updatedAt: string;
  writeId: string;
  shardCount?: number;
  shards?: FileVectorShardManifest[];
  chunkCount?: number;
  sourceCount?: number;
  keywordIndexedChunkCount?: number;
  keywordMinTokenLength?: number;
}

export interface FileVectorFormatValidationInput {
  manifest: FileVectorManifest;
  sources: SourceSnapshot[];
  shardChunkCounts: Map<string, number>;
  shardVectorByteLengths: Map<string, number>;
  keywordIndexedChunkCount: number;
}

export interface FileVectorIndexStoreOptions {
  folder: string;
  profileId?: string;
  shardCount?: number;
  now?: () => Date;
}

interface StoredChunk {
  row: FileVectorChunkRow;
  embedding: number[];
}

interface FileVectorIndexState {
  manifest: FileVectorManifest;
  sources: SourceSnapshot[];
  chunksByShard: Map<string, StoredChunk[]>;
}

interface FileVectorIndexWriteChanges {
  dirtyShardIds: Set<string>;
  sourcesDirty: boolean;
}

const DEFAULT_PROFILE_ID = "default";
const MANIFEST_FILE = "manifest.json";

export class FileVectorIndexStore
  implements IndexStore, SourceSnapshotIndexStore, KeywordSearchIndexStore, AdjacentChunkIndexStore
{
  private readonly folder: string;
  private readonly profileId: string;
  private readonly shardCount: number;
  private readonly now: () => Date;
  private state: FileVectorIndexState | null = null;

  constructor(options: FileVectorIndexStoreOptions) {
    this.folder = options.folder;
    this.profileId = options.profileId ?? DEFAULT_PROFILE_ID;
    this.shardCount = options.shardCount ?? DEFAULT_FILE_VECTOR_SHARD_COUNT;
    this.now = options.now ?? (() => new Date());
  }

  async initialize(metadata: IndexStoreMetadata): Promise<void> {
    const manifest = await this.readManifest();

    if (manifest === null) {
      if (await this.hasLegacyOrUnknownFiles()) {
        throwRebuildRequired({ reason: "legacy-or-unknown-index-files", folder: this.folder });
      }

      this.state = createEmptyState({
        profileId: this.profileId,
        metadata,
        shardCount: this.shardCount,
        now: this.now,
      });
      await this.persistState(this.state, { dirtyShardIds: new Set(), sourcesDirty: true });
      return;
    }

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

    this.state = await this.loadState(manifest);
  }

  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    const writer = await this.beginWrite();
    await writer.upsert(chunks);
    await writer.commit();
  }

  async deleteBySourcePath(path: string): Promise<void> {
    const state = this.state ?? (await this.loadExistingStateOrNull());

    if (state === null) {
      return;
    }

    const changes = createWriteChanges();
    const removed = removeSourcePathFromState(state, path, changes);

    if (!removed) {
      this.state = state;
      return;
    }

    refreshSources(state, this.now);
    changes.sourcesDirty = true;
    await this.persistState(state, changes);
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
          refreshSources(state, this.now);
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
        await this.persistState(state, changes);
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
    const state = this.state ?? (await this.loadExistingStateOrNull());

    if (state === null) {
      return [];
    }

    this.state = state;
    return state.sources
      .filter((source) => source.failed !== true)
      .map(({ sourcePath, modifiedTime, contentHash }) => ({
        sourcePath,
        modifiedTime,
        contentHash,
      }));
  }

  async updateSourceSnapshots(snapshots: IndexSourceSnapshot[]): Promise<void> {
    if (snapshots.length === 0) {
      return;
    }

    const state = this.requireState();
    applySourceSnapshotUpdates(state, snapshots);
    await this.persistState(state, { dirtyShardIds: new Set(), sourcesDirty: true });
  }

  async recordFailedSourceSnapshots(snapshots: IndexFailedSourceSnapshot[]): Promise<void> {
    if (snapshots.length === 0) {
      return;
    }

    const state = this.state ?? (await this.loadExistingStateOrNull());

    if (state === null) {
      return;
    }

    applyFailedSourceSnapshots(state, snapshots);
    await this.persistState(state, { dirtyShardIds: new Set(), sourcesDirty: true });
    this.state = state;
  }

  async query(embedding: number[], limit: number): Promise<RetrievedChunk[]> {
    if (limit <= 0) {
      return [];
    }

    const state = this.requireState();

    if (embedding.length !== state.manifest.embeddingDimensions) {
      throwRebuildRequired({
        reason: "query-dimensions-mismatch",
        expected: state.manifest.embeddingDimensions,
        actual: embedding.length,
      });
    }

    const queryVector = normalizeVector(embedding);
    const matches: RetrievedChunk[] = [];

    for (const shardChunks of state.chunksByShard.values()) {
      for (const chunk of shardChunks) {
        matches.push({
          id: chunk.row.id,
          source: chunk.row.source,
          text: chunk.row.text,
          contentHash: chunk.row.contentHash,
          score: dotProduct(queryVector, chunk.embedding),
        });
      }
    }

    return matches.sort((left, right) => right.score - left.score).slice(0, limit);
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
    const state = this.state ?? (await this.loadExistingStateOrNull());

    if (state === null) {
      return [];
    }

    this.state = state;
    const chunkById = new Map<string, FileVectorChunkRow>();
    const rowsByShard: KeywordPostingRow[][] = [];

    for (const shard of state.manifest.shards) {
      const shardChunks = state.chunksByShard.get(shard.id) ?? [];
      for (const chunk of shardChunks) {
        chunkById.set(chunk.row.id, chunk.row);
      }

      rowsByShard.push(
        await readJsonlIndexFile(
          this.pathFor(`keywords/${shard.id}.terms.jsonl`),
          isKeywordPostingRow,
        ),
      );
    }

    const matches = rankKeywordPostings(
      query,
      mergeKeywordPostingRows(rowsByShard),
      state.manifest.keywordIndex.minTokenLength,
      options.limit * 4,
    );
    const chunks: RetrievedChunk[] = [];

    for (const match of matches) {
      const row = chunkById.get(match.chunkId);

      if (!row) {
        continue;
      }

      const chunk: RetrievedChunk = {
        id: row.id,
        source: row.source,
        text: row.text,
        contentHash: row.contentHash,
        score: match.score,
      };

      if (chunkMatchesRetrievalOptions(chunk, options)) {
        chunks.push(chunk);
      }

      if (chunks.length >= options.limit) {
        break;
      }
    }

    return chunks;
  }

  async expandAdjacentChunks(
    chunks: RetrievedChunk[],
    radius: number,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    if (radius <= 0 || chunks.length === 0 || limit <= 0) {
      return chunks.slice(0, limit);
    }

    const state = this.state ?? (await this.loadExistingStateOrNull());

    if (state === null) {
      return chunks.slice(0, limit);
    }

    this.state = state;
    const byId = new Map<string, StoredChunk>();
    const bySourcePath = new Map<string, StoredChunk[]>();

    for (const shardChunks of state.chunksByShard.values()) {
      for (const chunk of shardChunks) {
        const sourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
        byId.set(chunk.row.id, chunk);
        const sourceChunks = bySourcePath.get(sourcePath) ?? [];
        sourceChunks.push(chunk);
        bySourcePath.set(sourcePath, sourceChunks);
      }
    }

    for (const sourceChunks of bySourcePath.values()) {
      sourceChunks.sort((left, right) => (left.row.chunkIndex ?? 0) - (right.row.chunkIndex ?? 0));
    }

    const expanded: RetrievedChunk[] = [];
    const seen = new Set<string>();

    for (const chunk of chunks) {
      const stored = byId.get(chunk.id);

      if (!stored) {
        appendChunk(chunk);
        continue;
      }

      const sourcePath = stored.row.sourcePath ?? sourcePathFromReference(stored.row.source);
      const sourceChunks = bySourcePath.get(sourcePath) ?? [];
      const index = sourceChunks.findIndex((candidate) => candidate.row.id === chunk.id);
      const start = Math.max(0, index - radius);
      const end = Math.min(sourceChunks.length, index + radius + 1);

      for (const candidate of sourceChunks.slice(start, end)) {
        appendChunk({
          id: candidate.row.id,
          source: candidate.row.source,
          text: candidate.row.text,
          contentHash: candidate.row.contentHash,
          score: candidate.row.id === chunk.id ? chunk.score : chunk.score * 0.98,
        });
      }

      if (expanded.length >= limit) {
        break;
      }
    }

    return expanded.slice(0, limit);

    function appendChunk(chunk: RetrievedChunk): void {
      if (seen.has(chunk.id) || expanded.length >= limit) {
        return;
      }

      seen.add(chunk.id);
      expanded.push(chunk);
    }
  }

  private async readManifest(): Promise<FileVectorManifest | null> {
    return readJsonIndexFile<FileVectorManifest | null>(
      this.pathFor(MANIFEST_FILE),
      isFileVectorManifestOrNull,
      null,
    );
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

  private async loadExistingStateOrNull(): Promise<FileVectorIndexState | null> {
    const manifest = await this.readManifest();

    if (manifest === null) {
      return null;
    }

    return this.loadState(manifest);
  }

  private async loadState(manifest: FileVectorManifest): Promise<FileVectorIndexState> {
    const sources = await readJsonlIndexFile(
      this.pathFor(manifest.sourceSnapshotFile),
      isSourceSnapshot,
    );
    const chunksByShard = new Map<string, StoredChunk[]>();
    const shardChunkCounts = new Map<string, number>();
    const shardVectorByteLengths = new Map<string, number>();
    const keywordIndexedChunkIds = new Set<string>();

    for (const shard of manifest.shards) {
      const rows = await readJsonlIndexFile(this.pathFor(shard.chunkMetadataFile), isChunkRow);
      const vectorBytes = await readBinaryIndexFile(this.pathFor(shard.vectorFile));

      shardChunkCounts.set(shard.id, rows.length);
      shardVectorByteLengths.set(shard.id, vectorBytes.byteLength);
      chunksByShard.set(shard.id, decodeStoredChunks(rows, vectorBytes, manifest));

      const keywordRows = await readJsonlIndexFile(
        this.pathFor(`keywords/${shard.id}.terms.jsonl`),
        isKeywordPostingRow,
      );

      for (const row of keywordRows) {
        for (const posting of row.postings) {
          keywordIndexedChunkIds.add(posting.chunkId);
        }
      }
    }

    validateFileVectorIndexFormat({
      manifest,
      sources,
      shardChunkCounts,
      shardVectorByteLengths,
      keywordIndexedChunkCount: keywordIndexedChunkIds.size,
    });

    return { manifest, sources, chunksByShard };
  }

  private async persistState(
    state: FileVectorIndexState,
    changes?: FileVectorIndexWriteChanges,
  ): Promise<void> {
    const writeId = createWriteId(this.now);
    const updatedAt = this.now().toISOString();
    const shardManifests: FileVectorShardManifest[] = [];
    const files: AtomicIndexFile[] =
      changes === undefined || changes.sourcesDirty
        ? [
            {
              path: this.pathFor("sources.jsonl"),
              data: toJsonl(state.sources),
            },
          ]
        : [];
    let keywordIndexedChunkCount = 0;

    for (const shard of state.manifest.shards) {
      const storedChunks = state.chunksByShard.get(shard.id) ?? [];
      const chunkRows = storedChunks.map((chunk) => chunk.row);
      const encoded = encodeStoredChunks(storedChunks, state.manifest.embeddingDimensions);
      const keywordRows = buildKeywordPostingRows(
        chunkRows,
        state.manifest.keywordIndex.minTokenLength,
      );
      const isDirty = changes === undefined || changes.dirtyShardIds.has(shard.id);

      keywordIndexedChunkCount += countIndexedKeywordChunks(keywordRows);
      shardManifests.push({
        id: shard.id,
        chunkMetadataFile: shard.chunkMetadataFile,
        vectorFile: shard.vectorFile,
        chunkCount: storedChunks.length,
        vectorByteLength: encoded.byteLength,
      });
      if (isDirty) {
        files.push(
          {
            path: this.pathFor(shard.chunkMetadataFile),
            data: toJsonl(chunkRows),
          },
          {
            path: this.pathFor(shard.vectorFile),
            data: encoded,
          },
          {
            path: this.pathFor(`keywords/${shard.id}.terms.jsonl`),
            data: toJsonl(keywordRows),
          },
        );
      }
    }

    const manifest = createFileVectorManifest({
      profileId: state.manifest.profileId,
      embeddingModel: state.manifest.embeddingModel,
      embeddingDimensions: state.manifest.embeddingDimensions,
      updatedAt,
      writeId,
      shardCount: state.manifest.shardCount,
      shards: shardManifests,
      chunkCount: shardManifests.reduce((total, shard) => total + shard.chunkCount, 0),
      sourceCount: state.sources.length,
      keywordIndexedChunkCount,
      keywordMinTokenLength: state.manifest.keywordIndex.minTokenLength,
    });

    state.manifest = manifest;

    await atomicWriteIndexFiles({
      files,
      manifest: {
        path: this.pathFor(MANIFEST_FILE),
        data: JSON.stringify(manifest, null, 2),
      },
      writeId,
    });
  }

  private pathFor(relativePath: string): string {
    return join(this.folder, relativePath);
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

export function createFileVectorManifest(
  options: CreateFileVectorManifestOptions,
): FileVectorManifest {
  const shardCount = options.shardCount ?? DEFAULT_FILE_VECTOR_SHARD_COUNT;
  const shards = options.shards ?? createEmptyShardManifests(shardCount);
  const keywordFiles = shards.map((shard) => `keywords/${shard.id}.terms.jsonl`);

  return {
    schemaVersion: FILE_VECTOR_INDEX_SCHEMA_VERSION,
    format: FILE_VECTOR_INDEX_FORMAT,
    profileId: options.profileId,
    embeddingModel: options.embeddingModel,
    embeddingDimensions: options.embeddingDimensions,
    vectorEncoding: "float32-le-normalized",
    sourceSnapshotFile: "sources.jsonl",
    shardCount,
    shards,
    keywordIndex: {
      schemaVersion: FILE_VECTOR_INDEX_SCHEMA_VERSION,
      tokenizer: "simple-lowercase",
      strategy: "source-shard",
      minTokenLength: options.keywordMinTokenLength ?? DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
      files: keywordFiles,
      indexedChunkCount: options.keywordIndexedChunkCount ?? options.chunkCount ?? 0,
    },
    chunkCount: options.chunkCount ?? sumShardChunks(shards),
    sourceCount: options.sourceCount ?? 0,
    updatedAt: options.updatedAt,
    writeId: options.writeId,
  };
}

export function createEmptyShardManifests(shardCount: number): FileVectorShardManifest[] {
  return Array.from({ length: shardCount }, (_, index) => {
    const id = index.toString(32).padStart(2, "0");

    return {
      id,
      chunkMetadataFile: `shards/${id}.chunks.jsonl`,
      vectorFile: `shards/${id}.vectors.bin`,
      chunkCount: 0,
      vectorByteLength: 0,
    };
  });
}

export function isFileVectorManifest(value: unknown): value is FileVectorManifest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schemaVersion === FILE_VECTOR_INDEX_SCHEMA_VERSION &&
    value.format === FILE_VECTOR_INDEX_FORMAT &&
    typeof value.profileId === "string" &&
    typeof value.embeddingModel === "string" &&
    isPositiveInteger(value.embeddingDimensions) &&
    value.vectorEncoding === "float32-le-normalized" &&
    value.sourceSnapshotFile === "sources.jsonl" &&
    isPositiveInteger(value.shardCount) &&
    Array.isArray(value.shards) &&
    value.shards.every(isFileVectorShardManifest) &&
    isKeywordIndexManifest(value.keywordIndex) &&
    isNonNegativeInteger(value.chunkCount) &&
    isNonNegativeInteger(value.sourceCount) &&
    typeof value.updatedAt === "string" &&
    typeof value.writeId === "string"
  );
}

export function isChunkRow(value: unknown): value is FileVectorChunkRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isSourceReference(value.source) &&
    (typeof value.sourcePath === "string" || value.sourcePath === undefined) &&
    typeof value.text === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.embeddingModel === "string" &&
    isNonNegativeInteger(value.vectorOffset) &&
    isPositiveInteger(value.vectorLength) &&
    (value.chunkIndex === undefined || isNonNegativeInteger(value.chunkIndex))
  );
}

export function isSourceSnapshot(value: unknown): value is SourceSnapshot {
  return (
    isRecord(value) &&
    typeof value.sourcePath === "string" &&
    isNonNegativeInteger(value.modifiedTime) &&
    typeof value.contentHash === "string" &&
    typeof value.indexedAt === "string" &&
    typeof value.shardId === "string" &&
    isNonNegativeInteger(value.chunkCount) &&
    (value.failed === undefined || typeof value.failed === "boolean") &&
    (value.errorMessage === undefined || typeof value.errorMessage === "string")
  );
}

export function isKeywordPostingRow(value: unknown): value is KeywordPostingRow {
  return (
    isRecord(value) &&
    typeof value.term === "string" &&
    Array.isArray(value.postings) &&
    value.postings.every(
      (posting) =>
        isRecord(posting) &&
        typeof posting.chunkId === "string" &&
        isPositiveInteger(posting.frequency),
    )
  );
}

export function validateFileVectorIndexFormat(input: FileVectorFormatValidationInput): void {
  const { manifest, sources, shardChunkCounts, shardVectorByteLengths, keywordIndexedChunkCount } =
    input;

  if (!isFileVectorManifest(manifest)) {
    throwInconsistentIndex({ reason: "invalid-manifest" });
  }

  if (manifest.sourceCount !== sources.length) {
    throwInconsistentIndex({
      reason: "source-count-mismatch",
      expected: manifest.sourceCount,
      actual: sources.length,
    });
  }

  if (manifest.keywordIndex.indexedChunkCount !== keywordIndexedChunkCount) {
    throwInconsistentIndex({
      reason: "keyword-count-mismatch",
      expected: manifest.keywordIndex.indexedChunkCount,
      actual: keywordIndexedChunkCount,
    });
  }

  let totalChunks = 0;

  for (const shard of manifest.shards) {
    const actualChunkCount = shardChunkCounts.get(shard.id) ?? 0;
    const actualVectorByteLength = shardVectorByteLengths.get(shard.id) ?? 0;
    const expectedVectorByteLength =
      shard.chunkCount * manifest.embeddingDimensions * VECTOR_FLOAT_BYTES;

    if (shard.chunkCount !== actualChunkCount) {
      throwInconsistentIndex({
        reason: "shard-chunk-count-mismatch",
        shardId: shard.id,
        expected: shard.chunkCount,
        actual: actualChunkCount,
      });
    }

    if (
      shard.vectorByteLength !== actualVectorByteLength ||
      shard.vectorByteLength !== expectedVectorByteLength
    ) {
      throwInconsistentIndex({
        reason: "shard-vector-length-mismatch",
        shardId: shard.id,
        expected: expectedVectorByteLength,
        actual: actualVectorByteLength,
      });
    }

    totalChunks += shard.chunkCount;
  }

  if (manifest.chunkCount !== totalChunks) {
    throwInconsistentIndex({
      reason: "manifest-chunk-count-mismatch",
      expected: manifest.chunkCount,
      actual: totalChunks,
    });
  }

  const sourceChunkCount = sources.reduce((total, source) => total + source.chunkCount, 0);
  if (sourceChunkCount !== manifest.chunkCount) {
    throwInconsistentIndex({
      reason: "source-chunk-count-mismatch",
      expected: manifest.chunkCount,
      actual: sourceChunkCount,
    });
  }
}

function isFileVectorShardManifest(value: unknown): value is FileVectorShardManifest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.chunkMetadataFile === "string" &&
    typeof value.vectorFile === "string" &&
    isNonNegativeInteger(value.chunkCount) &&
    isNonNegativeInteger(value.vectorByteLength)
  );
}

function isKeywordIndexManifest(value: unknown): value is KeywordIndexManifest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schemaVersion === FILE_VECTOR_INDEX_SCHEMA_VERSION &&
    value.tokenizer === "simple-lowercase" &&
    value.strategy === "source-shard" &&
    isPositiveInteger(value.minTokenLength) &&
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === "string") &&
    isNonNegativeInteger(value.indexedChunkCount)
  );
}

function isFileVectorManifestOrNull(value: unknown): value is FileVectorManifest | null {
  return value === null || isFileVectorManifest(value);
}

function isSourceReference(value: unknown): value is SourceReference {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") {
    return false;
  }

  switch (value.kind) {
    case "markdown":
      return typeof value.path === "string" && Array.isArray(value.headingPath);
    case "pdf":
      return typeof value.path === "string" && isPositiveInteger(value.pageNumber);
    case "document":
      return typeof value.path === "string" && typeof value.format === "string";
    case "web":
      return (
        typeof value.url === "string" &&
        typeof value.snippet === "string" &&
        typeof value.retrievedAt === "string" &&
        typeof value.wasContentFetched === "boolean"
      );
    default:
      return false;
  }
}

function sumShardChunks(shards: FileVectorShardManifest[]): number {
  return shards.reduce((total, shard) => total + shard.chunkCount, 0);
}

function throwInconsistentIndex(details: Record<string, unknown>): never {
  throwRebuildRequired(details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function createEmptyState(options: {
  profileId: string;
  metadata: IndexStoreMetadata;
  shardCount: number;
  now: () => Date;
}): FileVectorIndexState {
  const manifest = createFileVectorManifest({
    profileId: options.profileId,
    embeddingModel: options.metadata.embeddingModel,
    embeddingDimensions: options.metadata.embeddingDimensions,
    updatedAt: options.now().toISOString(),
    writeId: createWriteId(options.now),
    shardCount: options.shardCount,
  });

  return {
    manifest,
    sources: [],
    chunksByShard: new Map(manifest.shards.map((shard) => [shard.id, []])),
  };
}

function createWriteChanges(): FileVectorIndexWriteChanges {
  return { dirtyShardIds: new Set(), sourcesDirty: false };
}

function applyUpsertChunks(
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
  }

  refreshSources(state, now);
  changes.sourcesDirty = true;
}

function applySourceSnapshotUpdates(
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
    };
  });
}

function applyFailedSourceSnapshots(
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

function removeSourcePathFromState(
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
    .map(([sourcePath, chunks]) => ({
      sourcePath,
      modifiedTime: 0,
      contentHash: chunks[0]?.row.contentHash ?? "",
      indexedAt: now().toISOString(),
      shardId: shardIdForSourcePath(sourcePath, state.manifest.shardCount),
      chunkCount: chunks.length,
    }));
}

function encodeStoredChunks(chunks: StoredChunk[], dimensions: number): Uint8Array {
  const vectorData = new Float32Array(chunks.length * dimensions);

  chunks.forEach((chunk, chunkIndex) => {
    chunk.row.vectorOffset = chunkIndex * dimensions * VECTOR_FLOAT_BYTES;
    chunk.row.vectorLength = dimensions;
    vectorData.set(chunk.embedding, chunkIndex * dimensions);
  });

  return new Uint8Array(vectorData.buffer);
}

function decodeStoredChunks(
  rows: FileVectorChunkRow[],
  vectorBytes: Uint8Array,
  manifest: FileVectorManifest,
): StoredChunk[] {
  const vectorData = new Float32Array(
    vectorBytes.buffer,
    vectorBytes.byteOffset,
    Math.floor(vectorBytes.byteLength / VECTOR_FLOAT_BYTES),
  );

  return rows.map((row) => {
    const start = row.vectorOffset / VECTOR_FLOAT_BYTES;
    const end = start + row.vectorLength;

    if (
      row.vectorLength !== manifest.embeddingDimensions ||
      !Number.isInteger(start) ||
      end > vectorData.length
    ) {
      throwRebuildRequired({
        reason: "chunk-vector-range-invalid",
        chunkId: row.id,
        vectorOffset: row.vectorOffset,
        vectorLength: row.vectorLength,
      });
    }

    return {
      row,
      embedding: Array.from(vectorData.slice(start, end)),
    };
  });
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));

  if (magnitude === 0) {
    return vector.map(() => 0);
  }

  return vector.map((value) => value / magnitude);
}

function dotProduct(left: number[], right: number[]): number {
  let score = 0;

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    score += left[index] * right[index];
  }

  return score;
}

function sourcePathFromReference(source: SourceReference): string {
  if (source.kind === "web") {
    return source.url;
  }

  return source.path;
}

function toJsonl(rows: unknown[]): string {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function createWriteId(now: () => Date): string {
  return `${now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function throwRebuildRequired(details: Record<string, unknown>): never {
  throw new IxplorerError({
    code: "INDEX_REBUILD_REQUIRED",
    message: "The file-backed index format is inconsistent.",
    details,
  });
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
