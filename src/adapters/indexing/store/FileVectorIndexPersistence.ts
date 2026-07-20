import { join } from "path";

import {
  AtomicIndexFile,
  atomicWriteIndexFiles,
  readBinaryIndexFile,
  readJsonIndexFile,
  readJsonlIndexFile,
  readFirstJsonlIndexRows,
} from "../inventory/fileIndexFiles";
import {
  createFileVectorManifest,
  FileVectorChunkRow,
  FileVectorManifest,
  FileVectorShardManifest,
  isChunkRow,
  isFileVectorManifestOrNull,
  isKeywordPostingRow,
  isSourceSnapshot,
  KeywordPostingRow,
  validateFileVectorIndexFormat,
} from "./FileVectorIndexFormat";
import {
  encodeStoredChunks,
  decodeStoredChunks,
  sourcePathFromReference,
} from "./FileVectorIndexVector";
import {
  buildKeywordPostingRows,
  countIndexedKeywordChunks,
} from "../keyword/LightweightKeywordIndex";
import { languageInventoryFromSources } from "../pipeline/languageDetection";
import { FileVectorIndexState, FileVectorIndexWriteChanges } from "./FileVectorIndexState";

export interface FileVectorIndexPersistenceOptions {
  folder: string;
  now: () => Date;
  createWriteId: () => string;
  onPerformance?: (event: FileVectorIndexPersistenceEvent) => void;
}

export interface FileVectorIndexPersistenceEvent {
  phase: "keywordBuild" | "vectorEncode" | "manifestBuild" | "diskWrite" | "persist";
  durationMs: number;
  shardId?: string;
  dirtyShardCount?: number;
  writtenFileCount?: number;
  chunkCount?: number;
}

const MANIFEST_FILE = "manifest.json";

export class FileVectorIndexPersistence {
  private readonly folder: string;
  private readonly now: () => Date;
  private readonly createWriteId: () => string;
  private readonly onPerformance?: (event: FileVectorIndexPersistenceEvent) => void;

  constructor(options: FileVectorIndexPersistenceOptions) {
    this.folder = options.folder;
    this.now = options.now;
    this.createWriteId = options.createWriteId;
    this.onPerformance = options.onPerformance;
  }

  pathFor(relativePath: string): string {
    return join(this.folder, relativePath);
  }

  async readManifest(): Promise<FileVectorManifest | null> {
    return readJsonIndexFile<FileVectorManifest | null>(
      this.pathFor(MANIFEST_FILE),
      isFileVectorManifestOrNull,
      null,
    );
  }

  async loadExistingStateOrNull(): Promise<FileVectorIndexState | null> {
    const manifest = await this.readManifest();

    if (manifest === null) {
      return null;
    }

    return this.loadState(manifest);
  }

  async readRepresentativeChunkRows(
    manifest: FileVectorManifest,
    limit: number,
  ): Promise<FileVectorChunkRow[]> {
    const nonEmptyShards = manifest.shards
      .filter((shard) => shard.chunkCount > 0)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (nonEmptyShards.length === 0 || limit <= 0) {
      return [];
    }

    const rowsPerShard = Math.max(1, Math.ceil(limit / nonEmptyShards.length));
    const rows: FileVectorChunkRow[] = [];
    for (const shard of nonEmptyShards) {
      rows.push(
        ...(await readFirstJsonlIndexRows(
          this.pathFor(shard.chunkMetadataFile),
          isChunkRow,
          Math.min(rowsPerShard, limit - rows.length),
        )),
      );
      if (rows.length >= limit) {
        break;
      }
    }
    return rows;
  }

  async loadState(manifest: FileVectorManifest): Promise<FileVectorIndexState> {
    const sources = await readJsonlIndexFile(
      this.pathFor(manifest.sourceSnapshotFile),
      isSourceSnapshot,
    );
    const chunksByShard = new Map<string, ReturnType<typeof decodeStoredChunks>>();
    const shardChunkCounts = new Map<string, number>();
    const shardVectorByteLengths = new Map<string, number>();
    const keywordIndexedChunkIds = new Set<string>();

    for (const shard of manifest.shards) {
      const rows = await readJsonlIndexFile(this.pathFor(shard.chunkMetadataFile), isChunkRow);
      const vectorBytes = await readBinaryIndexFile(this.pathFor(shard.vectorFile));

      shardChunkCounts.set(shard.id, rows.length);
      shardVectorByteLengths.set(shard.id, vectorBytes.byteLength);
      chunksByShard.set(shard.id, decodeStoredChunks(rows, vectorBytes, manifest));

      const keywordRows = await this.readKeywordRows(shard.id);

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

  async persistState(
    state: FileVectorIndexState,
    changes?: FileVectorIndexWriteChanges,
  ): Promise<void> {
    const persistStartedAt = Date.now();
    const writeId = this.createWriteId();
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
      const isDirty = changes === undefined || changes.dirtyShardIds.has(shard.id);

      if (!isDirty) {
        shardManifests.push(shard);
        keywordIndexedChunkCount += shard.keywordIndexedChunkCount ?? shard.chunkCount;
        continue;
      }

      const storedChunks = state.chunksByShard.get(shard.id) ?? [];
      const chunkRows = storedChunks.map((chunk) => chunk.row);
      const vectorEncodeStartedAt = Date.now();
      const encoded = encodeStoredChunks(storedChunks, state.manifest.embeddingDimensions);
      this.logPerformance({
        phase: "vectorEncode",
        durationMs: Date.now() - vectorEncodeStartedAt,
        shardId: shard.id,
        chunkCount: storedChunks.length,
      });
      const keywordBuildStartedAt = Date.now();
      const keywordRows = await this.buildDirtyKeywordRows(state, shard, chunkRows, changes);
      const shardKeywordIndexedChunkCount = countIndexedKeywordChunks(keywordRows);
      this.logPerformance({
        phase: "keywordBuild",
        durationMs: Date.now() - keywordBuildStartedAt,
        shardId: shard.id,
        chunkCount: chunkRows.length,
      });

      keywordIndexedChunkCount += shardKeywordIndexedChunkCount;
      shardManifests.push({
        id: shard.id,
        chunkMetadataFile: shard.chunkMetadataFile,
        vectorFile: shard.vectorFile,
        chunkCount: storedChunks.length,
        vectorByteLength: encoded.byteLength,
        keywordIndexedChunkCount: shardKeywordIndexedChunkCount,
      });
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

    const manifestStartedAt = Date.now();
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
      languageInventory: languageInventoryFromSources(state.sources),
    });
    this.logPerformance({
      phase: "manifestBuild",
      durationMs: Date.now() - manifestStartedAt,
      dirtyShardCount: changes?.dirtyShardIds.size ?? state.manifest.shards.length,
    });

    state.manifest = manifest;

    const diskWriteStartedAt = Date.now();
    await atomicWriteIndexFiles({
      files,
      manifest: {
        path: this.pathFor(MANIFEST_FILE),
        data: JSON.stringify(manifest, null, 2),
      },
      writeId,
    });
    this.logPerformance({
      phase: "diskWrite",
      durationMs: Date.now() - diskWriteStartedAt,
      writtenFileCount: files.length + 1,
      dirtyShardCount: changes?.dirtyShardIds.size ?? state.manifest.shards.length,
    });
    this.logPerformance({
      phase: "persist",
      durationMs: Date.now() - persistStartedAt,
      writtenFileCount: files.length + 1,
      dirtyShardCount: changes?.dirtyShardIds.size ?? state.manifest.shards.length,
    });
  }

  private async readKeywordRows(shardId: string): Promise<KeywordPostingRow[]> {
    return readJsonlIndexFile(this.pathFor(`keywords/${shardId}.terms.jsonl`), isKeywordPostingRow);
  }

  private async buildDirtyKeywordRows(
    state: FileVectorIndexState,
    shard: FileVectorShardManifest,
    chunkRows: FileVectorChunkRow[],
    changes?: FileVectorIndexWriteChanges,
  ): Promise<KeywordPostingRow[]> {
    if (changes === undefined || !changes.dirtySourcePaths.size) {
      return buildKeywordPostingRows(chunkRows, state.manifest.keywordIndex.minTokenLength);
    }

    const dirtySourceRows = chunkRows.filter((row) => {
      const sourcePath = row.sourcePath ?? sourcePathFromReference(row.source);
      return changes.dirtySourcePaths.has(sourcePath);
    });
    const existingRows = await this.readKeywordRows(shard.id);
    const replacementRows = buildKeywordPostingRows(
      dirtySourceRows,
      state.manifest.keywordIndex.minTokenLength,
    );

    return mergeKeywordRowsReplacingChunks(existingRows, replacementRows, changes.replacedChunkIds);
  }

  private logPerformance(event: FileVectorIndexPersistenceEvent): void {
    this.onPerformance?.(event);
  }
}

function toJsonl(rows: unknown[]): string {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function mergeKeywordRowsReplacingChunks(
  existingRows: KeywordPostingRow[],
  replacementRows: KeywordPostingRow[],
  replacedChunkIds: Set<string>,
): KeywordPostingRow[] {
  const byTerm = new Map<string, Map<string, number>>();

  for (const row of existingRows) {
    const postings = getOrCreateMap(byTerm, row.term);

    for (const posting of row.postings) {
      if (!replacedChunkIds.has(posting.chunkId)) {
        postings.set(posting.chunkId, posting.frequency);
      }
    }
  }

  for (const row of replacementRows) {
    const postings = getOrCreateMap(byTerm, row.term);

    for (const posting of row.postings) {
      postings.set(posting.chunkId, posting.frequency);
    }
  }

  return Array.from(byTerm.entries())
    .filter(([, postings]) => postings.size > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, postings]) => ({
      term,
      postings: Array.from(postings.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([chunkId, frequency]) => ({ chunkId, frequency })),
    }));
}

function getOrCreateMap(map: Map<string, Map<string, number>>, key: string): Map<string, number> {
  const existing = map.get(key);

  if (existing) {
    return existing;
  }

  const created = new Map<string, number>();
  map.set(key, created);
  return created;
}
