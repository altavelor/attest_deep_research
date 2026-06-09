import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  FileVectorIndexStore,
  isFileVectorManifest,
} from "../../src/indexing/FileVectorIndexStore";
import { shardIdForSourcePath } from "../../src/indexing/sourcePathShard";
import { EmbeddedChunk, SourceReference } from "../../src/shared/types";

describe("FileVectorIndexStore", () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "ixplorer-file-index-"));
  });

  it("persists chunks in source-path shards and returns cosine-ranked results after reopen", async () => {
    const store = new FileVectorIndexStore({
      folder,
      profileId: "default",
      now: fixedNow,
    });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "alpha project note", [1, 0], "hash-a"),
      chunk("chunk-b", "Research/b.md", "beta project note", [0, 1], "hash-b"),
    ]);

    const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
    expect(isFileVectorManifest(manifest)).toBe(true);
    expect(manifest.chunkCount).toBe(2);
    expect(manifest.sourceCount).toBe(2);
    expect(manifest.shardCount).toBe(32);

    const shardId = shardIdForSourcePath("Research/a.md");
    expect(existsSync(join(folder, "shards", `${shardId}.chunks.jsonl`))).toBe(true);
    expect(existsSync(join(folder, "shards", `${shardId}.vectors.bin`))).toBe(true);
    expect(existsSync(join(folder, "keywords", `${shardId}.terms.jsonl`))).toBe(true);

    const reopened = new FileVectorIndexStore({ folder, profileId: "default" });
    await reopened.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });

    const results = await reopened.query([0.9, 0.1], 2);
    expect(results.map((result) => result.id)).toEqual(["chunk-a", "chunk-b"]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("replaces existing source chunks and updates sources.jsonl", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "old text", [1, 0], "old"),
      chunk("chunk-b", "Research/b.md", "other text", [0, 1], "other"),
    ]);
    await store.upsert([chunk("chunk-a-new", "Research/a.md", "new text", [0, 1], "new")]);

    const results = await store.query([0, 1], 10);
    expect(results.map((result) => result.id)).toEqual(["chunk-a-new", "chunk-b"]);

    const sources = readJsonl(join(folder, "sources.jsonl"));
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: "Research/a.md",
          contentHash: "new",
          chunkCount: 1,
        }),
      ]),
    );
  });

  it("persists source snapshot mtime and content hash updates separately from chunk metadata", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([chunk("chunk-a", "Research/a.md", "new text", [1, 0], "chunk-hash")]);
    await store.updateSourceSnapshots([
      {
        sourcePath: "Research/a.md",
        modifiedTime: 42,
        contentHash: "file-hash",
      },
    ]);

    const reopened = new FileVectorIndexStore({ folder, profileId: "default" });
    const snapshots = await reopened.loadSourceSnapshots();

    expect(snapshots).toEqual([
      {
        sourcePath: "Research/a.md",
        modifiedTime: 42,
        contentHash: "file-hash",
      },
    ]);
  });

  it("searches keyword postings without embeddings and updates them after source replacement", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "local model local retrieval", [1, 0], "hash-a"),
      chunk("chunk-b", "Research/b.md", "remote server notes", [0, 1], "hash-b"),
    ]);

    await expect(
      store.searchKeywords("local retrieval", { limit: 5, includeWebResults: false }),
    ).resolves.toEqual([expect.objectContaining({ id: "chunk-a", score: 3 })]);

    await store.upsert([
      chunk("chunk-a-new", "Research/a.md", "remote only now", [0, 1], "hash-new"),
    ]);

    await expect(
      store.searchKeywords("local retrieval", { limit: 5, includeWebResults: false }),
    ).resolves.toEqual([]);
  });

  it("deletes by source path and fully clears profile files", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "alpha", [1, 0], "hash-a"),
      chunk("chunk-b", "Research/b.md", "beta", [0, 1], "hash-b"),
    ]);

    await store.deleteBySourcePath("Research/a.md");
    expect((await store.query([1, 0], 10)).map((result) => result.id)).toEqual(["chunk-b"]);

    await store.clear();
    await expect(readdir(folder)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires a rebuild when embedding metadata changes", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });

    const reopened = new FileVectorIndexStore({ folder, profileId: "default" });
    await expect(
      reopened.initialize({ embeddingModel: "other-model", embeddingDimensions: 2 }),
    ).rejects.toMatchObject({ code: "INDEX_REBUILD_REQUIRED" });
  });

  it("treats legacy or unknown index files without a manifest as rebuild-required", async () => {
    writeFileSync(join(folder, "legacy-lancedb-file"), "not a file-backed manifest");
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await expect(
      store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 }),
    ).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
      details: expect.objectContaining({ reason: "legacy-or-unknown-index-files" }),
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
  return {
    id: `source-${path}`,
    kind: "markdown",
    title: path,
    path,
    headingPath: [],
  };
}

function fixedNow(): Date {
  return new Date("2026-01-01T00:00:00.000Z");
}

function readJsonl(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
