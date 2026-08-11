import {
  DEFAULT_FILE_VECTOR_SHARD_COUNT,
  createFileVectorManifest,
  FileVectorIndexStore,
  isFileVectorManifest,
  validateFileVectorIndexFormat,
} from "@adapters/indexing";
import { shardIdForSourcePath } from "@adapters/indexing";
import {
  isChunkRow,
  isKeywordPostingRow,
  isSourceSnapshot,
} from "@adapters/indexing/store/FileVectorIndexFormat";
import type { EmbeddedChunk, SourceReference } from "@core/model";

import { MemoryFileSystem } from "../helpers/memoryFileSystem";

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
      languageInventory: [{ language: "en", chunkCount: 2, sourceCount: 1 }],
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
            languages: ["en"],
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

  it("rejects rows that a partial write left incomplete", () => {
    expect(isChunkRow({ id: "c1", text: "t" })).toBe(false);
    expect(
      isChunkRow({
        id: "c1",
        source: { id: "s", kind: "markdown", title: "a.md", path: "a.md", headingPath: [] },
        text: "t",
        contentHash: "h",
        embeddingModel: "nomic",
        vectorOffset: 0,
      }),
    ).toBe(false);
    expect(isSourceSnapshot({ sourcePath: "a.md", modifiedTime: 1, contentHash: "h" })).toBe(false);
    expect(isKeywordPostingRow({ term: "alpha" })).toBe(false);
    expect(isKeywordPostingRow({ term: "alpha", postings: [{ chunkId: "c1" }] })).toBe(false);
  });
});

describe("corrupt file-backed index files", () => {
  const folder = ".ixplorer/index";
  let fileSystem: MemoryFileSystem;

  beforeEach(() => {
    fileSystem = new MemoryFileSystem();
  });

  async function writeIndex(): Promise<string> {
    const store = new FileVectorIndexStore({ fileSystem, folder, profileId: "default" });
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "alpha note", [1, 0], "hash-a"),
      chunk("chunk-b", "Research/a.md", "second alpha note", [1, 0], "hash-a"),
    ]);
    return shardIdForSourcePath("Research/a.md");
  }

  function reopen(): Promise<void> {
    return new FileVectorIndexStore({ fileSystem, folder, profileId: "default" }).initialize({
      embeddingModel: "nomic",
      embeddingDimensions: 2,
    });
  }

  it("fails to reopen an index whose chunk metadata row was truncated mid-write", async () => {
    const shardId = await writeIndex();
    const path = `${folder}/shards/${shardId}.chunks.jsonl`;
    const content = await fileSystem.readText(path);
    await fileSystem.writeText(path, content.slice(0, content.length - 20));

    await expect(reopen()).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
      message: "The file-backed index could not be read.",
    });
  });

  it("fails to reopen an index whose vector file was truncated", async () => {
    const shardId = await writeIndex();
    const path = `${folder}/shards/${shardId}.vectors.bin`;
    await fileSystem.writeBinary(path, (await fileSystem.readBinary(path)).slice(0, 8));

    await expect(reopen()).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
      details: { reason: "chunk-vector-range-invalid" },
    });
  });

  it("fails to reopen an index whose source snapshot is missing a written row", async () => {
    await writeIndex();
    await fileSystem.writeText(`${folder}/sources.jsonl`, "");

    await expect(reopen()).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
      details: { reason: "source-count-mismatch" },
    });
  });

  it("fails to reopen an index whose manifest was written only in part", async () => {
    await writeIndex();
    const path = `${folder}/manifest.json`;
    const manifest = JSON.parse(await fileSystem.readText(path)) as Record<string, unknown>;
    delete manifest.shards;
    await fileSystem.writeText(path, JSON.stringify(manifest));

    await expect(reopen()).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
      message: "The file-backed index could not be read.",
    });
  });

  it("fails to reopen an index whose keyword postings were not all flushed", async () => {
    const shardId = await writeIndex();
    await fileSystem.writeText(`${folder}/keywords/${shardId}.terms.jsonl`, "");

    await expect(reopen()).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
      details: { reason: "keyword-count-mismatch" },
    });
  });
});

function chunk(
  id: string,
  path: string,
  text: string,
  embedding: number[],
  contentHash: string,
): EmbeddedChunk {
  return {
    id,
    source: markdownSource(path),
    text,
    contentHash,
    embedding,
    embeddingModel: "nomic",
  };
}

function markdownSource(path: string): SourceReference {
  return { id: `source-${path}`, kind: "markdown", title: path, path, headingPath: [] };
}
