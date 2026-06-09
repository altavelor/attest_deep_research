import {
  DEFAULT_FILE_VECTOR_SHARD_COUNT,
  createFileVectorManifest,
  isFileVectorManifest,
  validateFileVectorIndexFormat,
} from "../../src/indexing/FileVectorIndexStore";
import { shardIdForSourcePath } from "../../src/indexing/sourcePathShard";

describe("file vector index format", () => {
  it("creates a versioned manifest for 32 source-path hash shards", () => {
    const manifest = createFileVectorManifest({
      profileId: "default",
      embeddingModel: "nomic",
      embeddingDimensions: 3,
      updatedAt: "2026-06-02T00:00:00.000Z",
      writeId: "write-1",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 2,
      format: "ixplorer-file-vector-index",
      profileId: "default",
      embeddingModel: "nomic",
      embeddingDimensions: 3,
      vectorEncoding: "float32-le-normalized",
      sourceSnapshotFile: "sources.jsonl",
      shardCount: DEFAULT_FILE_VECTOR_SHARD_COUNT,
      chunkCount: 0,
      sourceCount: 0,
      updatedAt: "2026-06-02T00:00:00.000Z",
      writeId: "write-1",
    });
    expect(manifest.shards).toHaveLength(32);
    expect(manifest.shards[0]).toEqual({
      id: "00",
      chunkMetadataFile: "shards/00.chunks.jsonl",
      vectorFile: "shards/00.vectors.bin",
      chunkCount: 0,
      vectorByteLength: 0,
    });
    expect(manifest.keywordIndex).toEqual({
      schemaVersion: 2,
      tokenizer: "simple-lowercase",
      strategy: "source-shard",
      minTokenLength: 3,
      files: manifest.shards.map((shard) => `keywords/${shard.id}.terms.jsonl`),
      indexedChunkCount: 0,
    });
    expect(isFileVectorManifest(manifest)).toBe(true);
  });

  it("maps source paths to stable two-character shard ids", () => {
    const first = shardIdForSourcePath("Research/a.md");
    const second = shardIdForSourcePath("Research/a.md");
    const third = shardIdForSourcePath("Research/b.md");

    expect(first).toMatch(/^[0-9a-v]{2}$/);
    expect(first).toBe(second);
    expect(third).toMatch(/^[0-9a-v]{2}$/);
  });

  it("validates source snapshots, chunk rows, vector byte lengths, and keyword postings", () => {
    const manifest = createFileVectorManifest({
      profileId: "default",
      embeddingModel: "nomic",
      embeddingDimensions: 2,
      updatedAt: "2026-06-02T00:00:00.000Z",
      writeId: "write-1",
      shards: [
        {
          id: "00",
          chunkMetadataFile: "shards/00.chunks.jsonl",
          vectorFile: "shards/00.vectors.bin",
          chunkCount: 2,
          vectorByteLength: 16,
        },
      ],
      chunkCount: 2,
      sourceCount: 1,
      keywordIndexedChunkCount: 2,
    });

    expect(() =>
      validateFileVectorIndexFormat({
        manifest,
        sources: [
          {
            sourcePath: "Research/a.md",
            modifiedTime: 1,
            contentHash: "hash",
            indexedAt: "2026-06-02T00:00:00.000Z",
            shardId: "00",
            chunkCount: 2,
          },
        ],
        shardChunkCounts: new Map([["00", 2]]),
        shardVectorByteLengths: new Map([["00", 16]]),
        keywordIndexedChunkCount: 2,
      }),
    ).not.toThrow();

    expect(() =>
      validateFileVectorIndexFormat({
        manifest,
        sources: [],
        shardChunkCounts: new Map([["00", 2]]),
        shardVectorByteLengths: new Map([["00", 12]]),
        keywordIndexedChunkCount: 2,
      }),
    ).toThrowError("The file-backed index format is inconsistent.");
  });
});
