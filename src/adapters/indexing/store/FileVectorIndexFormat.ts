import { isRecord } from "@shared";
import { isNonNegativeInteger, isPositiveInteger } from "@shared";
import { LanguageInventoryItem } from "@core/model";
import { SourceReference } from "@core/model";
import { throwRebuildRequired } from "./FileVectorIndexErrors";
import type { IndexDescription } from "../inventory/IndexDescription";

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
  mode: "wholeVault" | "selected";
  indexFolder: string;
  includeFolders: string[];
  excludeGlobs: string[];
  embeddingModelProfileId: string;
  isSuspended?: boolean;
  suspendedReason?: string;
  lastIndexedAt?: string;
  indexedFileCount?: number;
  indexSizeBytes?: number;
  sourceKinds?: Array<SourceReference["kind"]>;
  indexDescription?: IndexDescription;
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
  languageInventory?: LanguageInventoryItem[];
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
  keywordIndexedChunkCount?: number;
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
  languages?: string[];
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
    /** Term frequency inside the chunk's headingPath; absent in v1 files (reads as 0). */
    headingFrequency?: number;
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
  languageInventory?: LanguageInventoryItem[];
}

export interface FileVectorFormatValidationInput {
  manifest: FileVectorManifest;
  sources: SourceSnapshot[];
  shardChunkCounts: Map<string, number>;
  shardVectorByteLengths: Map<string, number>;
  keywordIndexedChunkCount: number;
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
    ...(options.languageInventory ? { languageInventory: options.languageInventory } : {}),
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
    (value.languageInventory === undefined || isLanguageInventory(value.languageInventory)) &&
    isNonNegativeInteger(value.chunkCount) &&
    isNonNegativeInteger(value.sourceCount) &&
    typeof value.updatedAt === "string" &&
    typeof value.writeId === "string"
  );
}

export function isFileVectorManifestOrNull(value: unknown): value is FileVectorManifest | null {
  return value === null || isFileVectorManifest(value);
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
    (value.errorMessage === undefined || typeof value.errorMessage === "string") &&
    (value.languages === undefined || isLanguageList(value.languages))
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
        isPositiveInteger(posting.frequency) &&
        (posting.headingFrequency === undefined || isPositiveInteger(posting.headingFrequency)),
    )
  );
}

export function validateFileVectorIndexFormat(input: FileVectorFormatValidationInput): void {
  const { manifest, sources, shardChunkCounts, shardVectorByteLengths, keywordIndexedChunkCount } =
    input;

  if (!isFileVectorManifest(manifest)) {
    throwRebuildRequired({ reason: "invalid-manifest" });
  }

  if (manifest.sourceCount !== sources.length) {
    throwRebuildRequired({
      reason: "source-count-mismatch",
      expected: manifest.sourceCount,
      actual: sources.length,
    });
  }

  if (manifest.keywordIndex.indexedChunkCount !== keywordIndexedChunkCount) {
    throwRebuildRequired({
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
      throwRebuildRequired({
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
      throwRebuildRequired({
        reason: "shard-vector-length-mismatch",
        shardId: shard.id,
        expected: expectedVectorByteLength,
        actual: actualVectorByteLength,
      });
    }

    totalChunks += shard.chunkCount;
  }

  if (manifest.chunkCount !== totalChunks) {
    throwRebuildRequired({
      reason: "manifest-chunk-count-mismatch",
      expected: manifest.chunkCount,
      actual: totalChunks,
    });
  }

  const sourceChunkCount = sources.reduce((total, source) => total + source.chunkCount, 0);
  if (sourceChunkCount !== manifest.chunkCount) {
    throwRebuildRequired({
      reason: "source-chunk-count-mismatch",
      expected: manifest.chunkCount,
      actual: sourceChunkCount,
    });
  }
}

function isLanguageInventory(value: unknown): value is LanguageInventoryItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.language === "string" &&
        isNonNegativeInteger(item.chunkCount) &&
        isNonNegativeInteger(item.sourceCount),
    )
  );
}

function isLanguageList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
