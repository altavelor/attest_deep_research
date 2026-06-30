import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  FileVectorIndexStore,
  isFileVectorManifest,
} from "../../src/adapters/indexing/store/FileVectorIndexStore";
import { FileVectorInventoryStore } from "../../src/adapters/indexing/inventory/FileVectorInventoryStore";
import { FileVectorIndexReader } from "../../src/adapters/indexing/store/FileVectorIndexReader";
import { shardIdForSourcePath } from "../../src/adapters/indexing/inventory/sourcePathShard";
import { EmbeddedChunk, SourceReference } from "../../src/core/model/source";

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

  it("does not create empty shard files during initialization", async () => {
    const store = new FileVectorIndexStore({
      folder,
      profileId: "default",
      now: fixedNow,
    });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });

    expect(existsSync(join(folder, "manifest.json"))).toBe(true);
    expect(existsSync(join(folder, "sources.jsonl"))).toBe(true);
    expect(existsSync(join(folder, "shards"))).toBe(false);
    expect(existsSync(join(folder, "keywords"))).toBe(false);
  });

  it("commits write sessions once and writes only changed source shards", async () => {
    const store = new FileVectorIndexStore({
      folder,
      profileId: "default",
      now: fixedNow,
    });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    const writer = await store.beginWrite();
    await writer.upsert([
      chunk("chunk-a", "Research/a.md", "alpha project note", [1, 0], "hash-a"),
      chunk("chunk-a-2", "Research/a.md", "alpha second note", [1, 0], "hash-a"),
    ]);
    await writer.upsert([
      chunk("chunk-a-3", "Research/a.md", "alpha third note", [1, 0], "hash-a"),
    ]);

    expect(existsSync(join(folder, "shards"))).toBe(false);

    await writer.commit();

    const shardId = shardIdForSourcePath("Research/a.md");
    const shardFiles = await readdir(join(folder, "shards"));
    expect(shardFiles.sort()).toEqual([`${shardId}.chunks.jsonl`, `${shardId}.vectors.bin`]);
    expect((await store.query([1, 0], 10)).map((result) => result.id)).toEqual([
      "chunk-a",
      "chunk-a-2",
      "chunk-a-3",
    ]);
  });

  it("replaces existing source chunks and updates sources.jsonl", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "old text", [1, 0], "old"),
      chunk("chunk-b", "Research/b.md", "other text", [0, 1], "other"),
    ]);
    await store.deleteBySourcePath("Research/a.md");
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
        languages: ["en"],
      },
    ]);

    const reopened = new FileVectorIndexStore({ folder, profileId: "default" });
    const snapshots = await reopened.loadSourceSnapshots();

    expect(snapshots).toEqual([
      {
        sourcePath: "Research/a.md",
        modifiedTime: 42,
        contentHash: "file-hash",
        languages: ["en"],
      },
    ]);
    await expect(new FileVectorIndexReader(reopened, reopened).getLanguageInventory()).resolves.toEqual([
      { language: "en", chunkCount: 1, sourceCount: 1 },
    ]);
  });

  it("loads per-source report with chunk counts and failed reasons", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "first chunk", [1, 0], "hash-a"),
      chunk("chunk-b", "Research/a.md", "second chunk", [1, 0], "hash-a"),
    ]);
    await store.recordFailedSourceSnapshots([
      {
        sourcePath: "Research/broken.pdf",
        modifiedTime: 42,
        indexedAt: "2026-06-14T12:00:00.000Z",
        errorMessage: "PDF text extraction failed.",
      },
    ]);

    await expect(store.loadSourceReport()).resolves.toEqual([
      expect.objectContaining({
        sourcePath: "Research/a.md",
        status: "indexed",
        chunkCount: 2,
        errorMessage: undefined,
      }),
      expect.objectContaining({
        sourcePath: "Research/broken.pdf",
        status: "failed",
        chunkCount: 0,
        errorMessage: "PDF text extraction failed.",
      }),
    ]);
  });

  it("derives language inventory from stored chunks when manifest inventory is unavailable", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk(
        "chunk-a",
        "Books/algorithms.md",
        "Sorting algorithms include quicksort, merge sort, heap sort, and insertion sort. Their advantages and disadvantages depend on time complexity.",
        [1, 0],
        "hash-a",
      ),
    ]);

    const reopened = new FileVectorIndexStore({ folder, profileId: "default" });

    await expect(new FileVectorIndexReader(reopened, reopened).getLanguageInventory()).resolves.toEqual([
      { language: "en", chunkCount: 1, sourceCount: 1 },
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
      new FileVectorIndexReader(store, store).searchKeywords("local retrieval", { limit: 5, includeWebResults: false }),
    ).resolves.toEqual([expect.objectContaining({ id: "chunk-a", score: 3 })]);

    await store.deleteBySourcePath("Research/a.md");
    await store.upsert([
      chunk("chunk-a-new", "Research/a.md", "remote only now", [0, 1], "hash-new"),
    ]);

    await expect(
      new FileVectorIndexReader(store, store).searchKeywords("local retrieval", { limit: 5, includeWebResults: false }),
    ).resolves.toEqual([]);
  });

  it("updates keyword postings for dirty sources without dropping clean sources in the same shard", async () => {
    const [leftPath, rightPath] = sameShardPaths();
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-left", leftPath, "old privacy phrase", [1, 0], "left-old"),
      chunk("chunk-right", rightPath, "stable keyword survives", [0, 1], "right"),
    ]);

    const writer = await store.beginWrite();
    await writer.deleteBySourcePath(leftPath);
    await writer.upsert([
      chunk("chunk-left-new", leftPath, "new replacement phrase", [1, 0], "left-new"),
    ]);
    await writer.commit();

    await expect(
      new FileVectorIndexReader(store, store).searchKeywords("old privacy", { limit: 5, includeWebResults: false }),
    ).resolves.toEqual([]);
    await expect(
      new FileVectorIndexReader(store, store).searchKeywords("stable keyword", { limit: 5, includeWebResults: false }),
    ).resolves.toEqual([expect.objectContaining({ id: "chunk-right" })]);
  });

  it("records per-shard keyword counts in the manifest for clean-shard reuse", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([chunk("chunk-a", "Research/a.md", "alpha keyword", [1, 0], "hash-a")]);

    const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
    const shardId = shardIdForSourcePath("Research/a.md");
    const shard = manifest.shards.find((candidate: { id: string }) => candidate.id === shardId);

    expect(shard).toMatchObject({ keywordIndexedChunkCount: 1 });
  });

  it("keeps earlier chunks when one source is upserted across embedding batches", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a-1", "Research/a.md", "first", [1, 0], "hash-1"),
      chunk("chunk-a-2", "Research/a.md", "second", [1, 0], "hash-2"),
    ]);
    await store.upsert([chunk("chunk-a-3", "Research/a.md", "third", [1, 0], "hash-3")]);

    expect((await store.query([1, 0], 10)).map((result) => result.id)).toEqual([
      "chunk-a-1",
      "chunk-a-2",
      "chunk-a-3",
    ]);

    const sources = readJsonl(join(folder, "sources.jsonl"));
    expect(sources).toEqual([
      expect.objectContaining({
        sourcePath: "Research/a.md",
        chunkCount: 3,
      }),
    ]);
  });

  it("expands adjacent chunks from the same source path", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "first", [1, 0], "hash-a"),
      chunk("chunk-b", "Research/a.md", "second", [1, 0], "hash-b"),
      chunk("chunk-c", "Research/a.md", "third", [1, 0], "hash-c"),
    ]);

    const expanded = await new FileVectorIndexReader(store, store).expandAdjacentChunks(
      [{ ...chunk("chunk-b", "Research/a.md", "second", [1, 0], "hash-b"), score: 0.9 }],
      1,
      3,
    );

    expect(expanded.map((chunk) => chunk.id)).toEqual(["chunk-a", "chunk-b", "chunk-c"]);
  });

  it("returns adjacent chunks by source and chunk id", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "first", [1, 0], "hash-a"),
      chunk("chunk-b", "Research/a.md", "second", [1, 0], "hash-b"),
      chunk("chunk-c", "Research/a.md", "third", [1, 0], "hash-c"),
      chunk("chunk-d", "Research/other.md", "other", [1, 0], "hash-d"),
    ]);

    const adjacent = await new FileVectorIndexReader(store, store).getAdjacentChunks(markdownSource("Research/a.md"), "chunk-b", 1);

    expect(adjacent.map((chunk) => chunk.id)).toEqual(["chunk-a", "chunk-b", "chunk-c"]);
    expect(adjacent.map((chunk) => chunk.text)).toEqual(["first", "second", "third"]);
  });

  it("returns no adjacent chunks when the source or chunk id is missing", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([chunk("chunk-a", "Research/a.md", "first", [1, 0], "hash-a")]);

    await expect(
      new FileVectorIndexReader(store, store).getAdjacentChunks(markdownSource("Research/a.md"), "missing", 1),
    ).resolves.toEqual([]);
    await expect(
      new FileVectorIndexReader(store, store).getAdjacentChunks(markdownSource("Research/other.md"), "chunk-a", 1),
    ).resolves.toEqual([]);
  });

  it("lists indexed sources with filters and cursor pagination", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("book-a", "Books/Alpha.md", "alpha text", [1, 0], "hash-a"),
      chunk("note-b", "Notes/Beta.md", "beta text", [0, 1], "hash-b"),
    ]);
    await store.updateSourceSnapshots([
      {
        sourcePath: "Books/Alpha.md",
        modifiedTime: 10,
        contentHash: "file-a",
        languages: ["en"],
      },
    ]);

    await expect(
      new FileVectorInventoryStore(store).listIndexSources({ limit: 10, pathPrefix: "Books/", query: "alpha" }),
    ).resolves.toMatchObject({
      items: [
        {
          sourcePath: "Books/Alpha.md",
          title: "Books/Alpha.md",
          kind: "markdown",
          chunkCount: 1,
          languages: ["en"],
        },
      ],
    });

    const first = await new FileVectorInventoryStore(store).listIndexSources({ limit: 1 });
    const second = await new FileVectorInventoryStore(store).listIndexSources({ limit: 1, cursor: first.nextCursor });

    expect(first.items.map((item) => item.sourcePath)).toEqual(["Books/Alpha.md"]);
    expect(second.items.map((item) => item.sourcePath)).toEqual(["Notes/Beta.md"]);
  });

  it("lists chunks for one source in document order and filters by heading path", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("intro", "Books/Guide.md", "intro", [1, 0], "hash-1", ["Intro"]),
      chunk("chapter-a", "Books/Guide.md", "chapter alpha", [1, 0], "hash-2", ["Chapter 1"]),
      chunk("chapter-b", "Books/Guide.md", "chapter beta", [1, 0], "hash-3", ["Chapter 1"]),
      chunk("other", "Books/Other.md", "other", [1, 0], "hash-4", ["Chapter 1"]),
    ]);

    await expect(
      new FileVectorInventoryStore(store).listIndexChunks({
        sourcePath: "Books/Guide.md",
        headingPath: ["Chapter 1"],
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: [
        { chunkId: "chapter-a", chunkIndex: 1, headingPath: ["Chapter 1"] },
        { chunkId: "chapter-b", chunkIndex: 2, headingPath: ["Chapter 1"] },
      ],
    });
  });

  it("reads a bounded chunk window and marks truncated chunks", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("before", "Books/Guide.md", "before text", [1, 0], "hash-1"),
      chunk("hit", "Books/Guide.md", "hit text is long", [1, 0], "hash-2"),
      chunk("after", "Books/Guide.md", "after text", [1, 0], "hash-3"),
    ]);

    const result = await new FileVectorInventoryStore(store).readIndexChunk({ chunkId: "hit", before: 1, after: 1, maxChars: 27 });

    expect(result.chunks.map((item) => item.chunkId)).toEqual(["before", "hit"]);
    expect(result.chunks.map((item) => item.text)).toEqual(["before text", "hit text is long"]);
    expect(result.chunks[1]).toMatchObject({ truncated: false, charCount: 16 });
  });

  it("finds literal and regex matches without semantic ranking", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("a", "Books/Guide.md", "ISBN 978-1-4028-9462-6 and email Test@Example.com", [1, 0], "hash-a"),
      chunk("b", "Books/Other.md", "test@example.com outside scope", [1, 0], "hash-b"),
    ]);

    await expect(
      new FileVectorInventoryStore(store).findInIndex({
        pattern: "test@example.com",
        mode: "literal",
        sourcePath: "Books/Guide.md",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: [{ chunkId: "a", match: "Test@Example.com" }],
    });
    await expect(
      new FileVectorInventoryStore(store).findInIndex({
        pattern: "test@example.com",
        mode: "literal",
        sourcePath: "Books/Guide.md",
        caseSensitive: true,
        limit: 10,
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      new FileVectorInventoryStore(store).findInIndex({ pattern: "ISBN\\s+[0-9-]+", mode: "regex", limit: 10 }),
    ).resolves.toMatchObject({
      items: [{ chunkId: "a", match: "ISBN 978-1-4028-9462-6" }],
    });
  });

  it("returns source outline, summary topics, and metadata search results", async () => {
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("a", "Books/Guide.md", "alpha alpha retrieval topic", [1, 0], "hash-a", ["Intro"]),
      chunk("b", "Books/Guide.md", "beta retrieval topic", [1, 0], "hash-b", ["Chapter 1"]),
    ]);
    await store.updateSourceSnapshots([
      {
        sourcePath: "Books/Guide.md",
        modifiedTime: 20,
        contentHash: "file-guide",
        languages: ["en"],
      },
    ]);

    await expect(new FileVectorInventoryStore(store).getIndexSourceOutline("Books/Guide.md")).resolves.toMatchObject({
      sourcePath: "Books/Guide.md",
      chunkCount: 2,
      sections: [
        { headingPath: ["Intro"], chunkStart: 0, chunkEnd: 0 },
        { headingPath: ["Chapter 1"], chunkStart: 1, chunkEnd: 1 },
      ],
    });
    await expect(new FileVectorInventoryStore(store).summarizeIndexSource("Books/Guide.md", 1)).resolves.toMatchObject({
      sections: [{ headingPath: ["Intro"] }],
      topics: expect.arrayContaining([{ term: "retrieval", count: 2 }]),
    });
    await expect(
      new FileVectorInventoryStore(store).searchIndexByMetadata({
        sourceKind: "markdown",
        pathPrefix: "Books/",
        extension: "md",
        heading: "chapter",
        language: "en",
        indexedAfter: "2025-12-31T00:00:00.000Z",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: [{ sourcePath: "Books/Guide.md" }],
    });
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

  it("initializes a current manifest when files exist without a manifest", async () => {
    writeFileSync(join(folder, "unknown-file"), "not a file-backed manifest");
    const store = new FileVectorIndexStore({ folder, profileId: "default", now: fixedNow });

    await expect(
      store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 }),
    ).resolves.toBeUndefined();
    expect(existsSync(join(folder, "manifest.json"))).toBe(true);
  });
});

function chunk(
  id: string,
  path: string,
  text: string,
  embedding: number[],
  contentHash: string,
  headingPath: string[] = [],
): EmbeddedChunk {
  return {
    id,
    source: markdownSource(path, headingPath),
    text,
    contentHash,
    embedding,
    embeddingModel: "nomic",
  };
}

function markdownSource(path: string, headingPath: string[] = []): SourceReference {
  return {
    id: `source-${path}`,
    kind: "markdown",
    title: path,
    path,
    headingPath,
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

function sameShardPaths(): [string, string] {
  const first = "Research/collision-0.md";
  const shard = shardIdForSourcePath(first);

  for (let index = 1; index < 500; index += 1) {
    const candidate = `Research/collision-${index}.md`;
    if (shardIdForSourcePath(candidate) === shard) {
      return [first, candidate];
    }
  }

  throw new Error("Could not find two test paths in the same shard.");
}
