import {
  findInFileVectorIndex,
  getFileVectorIndexSourceOutline,
  listFileVectorIndexChunks,
  listFileVectorIndexSources,
  readFileVectorIndexChunk,
  readFileVectorIndexSection,
  searchFileVectorIndexByMetadata,
  summarizeFileVectorIndexSource,
} from "@adapters/indexing/inventory/FileVectorIndexInventory";
import type {
  FileVectorIndexState,
  StoredChunk,
} from "@adapters/indexing/store/FileVectorIndexState";
import type {
  FileVectorChunkRow,
  FileVectorManifest,
  SourceSnapshot,
} from "@adapters/indexing/store/FileVectorIndexFormat";

interface ChunkInput {
  id: string;
  sourcePath: string;
  text: string;
  chunkIndex?: number;
  headingPath?: string[];
  legacy?: boolean;
  title?: string;
}

function chunk(input: ChunkInput): StoredChunk {
  const row: FileVectorChunkRow = {
    id: input.id,
    source: {
      id: `src-${input.id}`,
      kind: "markdown",
      path: input.sourcePath,
      title: input.title ?? input.sourcePath,
      headingPath: input.headingPath ?? [],
    },
    text: input.text,
    contentHash: `hash-${input.id}`,
    embeddingModel: "nomic",
    vectorOffset: 0,
    vectorLength: 2,
    ...(input.chunkIndex === undefined ? {} : { chunkIndex: input.chunkIndex }),
    ...(input.legacy === true ? {} : { sourcePath: input.sourcePath }),
  };
  return { row, embedding: new Float32Array([1, 0]) };
}

function source(overrides: Partial<SourceSnapshot> & { sourcePath: string }): SourceSnapshot {
  return {
    modifiedTime: 1,
    contentHash: "hash",
    indexedAt: "2026-06-20T10:00:00.000Z",
    shardId: "shard-0",
    chunkCount: 1,
    ...overrides,
  };
}

function stateOf(chunks: StoredChunk[], sources: SourceSnapshot[]): FileVectorIndexState {
  return {
    manifest: { profileId: "default" } as unknown as FileVectorManifest,
    sources,
    chunksByShard: new Map([["shard-0", chunks]]),
  };
}

const notesChunks = [
  chunk({ id: "c-1", sourcePath: "Notes/a.md", text: "Alpha body text", chunkIndex: 0 }),
  chunk({
    id: "c-2",
    sourcePath: "Notes/a.md",
    text: "Beta body text",
    chunkIndex: 1,
    headingPath: ["Chapter", "Beta"],
  }),
];
const notesState = stateOf(notesChunks, [source({ sourcePath: "Notes/a.md", chunkCount: 2 })]);

describe("index inventory rejects invalid read options", () => {
  it("returns an empty page for a non-positive chunk limit", () => {
    expect(listFileVectorIndexChunks(notesState, { sourcePath: "Notes/a.md", limit: 0 })).toEqual({
      items: [],
    });
    expect(listFileVectorIndexSources(notesState, { limit: -1 })).toEqual({
      items: [],
      totalCount: 1,
    });
  });

  it("returns no chunks for negative context windows or a non-positive character budget", () => {
    expect(
      readFileVectorIndexChunk(notesState, {
        chunkId: "c-1",
        before: -1,
        after: 0,
        maxChars: 100,
      }),
    ).toEqual({ chunks: [] });
    expect(
      readFileVectorIndexChunk(notesState, { chunkId: "c-1", before: 0, after: -1, maxChars: 100 }),
    ).toEqual({ chunks: [] });
    expect(
      readFileVectorIndexChunk(notesState, { chunkId: "c-1", before: 0, after: 0, maxChars: 0 }),
    ).toEqual({ chunks: [] });
    expect(readFileVectorIndexSection(notesState, { chunkId: "c-1", maxChars: 0 })).toBeNull();
  });

  it("returns nothing for a chunk id that is not in the index", () => {
    expect(
      readFileVectorIndexChunk(notesState, {
        chunkId: "missing",
        before: 1,
        after: 1,
        maxChars: 100,
      }),
    ).toEqual({ chunks: [] });
    expect(
      readFileVectorIndexSection(notesState, { chunkId: "missing", maxChars: 100 }),
    ).toBeNull();
  });

  it("treats a corrupt cursor as the start of the page", () => {
    const fromGarbage = listFileVectorIndexChunks(notesState, {
      sourcePath: "Notes/a.md",
      limit: 10,
      cursor: "not-a-number",
    });
    const fromNegative = listFileVectorIndexChunks(notesState, {
      sourcePath: "Notes/a.md",
      limit: 10,
      cursor: "-5",
    });

    expect(fromGarbage.items.map((item) => item.chunkId)).toEqual(["c-1", "c-2"]);
    expect(fromNegative.items.map((item) => item.chunkId)).toEqual(["c-1", "c-2"]);
  });

  it("clamps a section cursor beyond the section to an empty continuation", () => {
    const section = readFileVectorIndexSection(notesState, {
      chunkId: "c-1",
      maxChars: 100,
      cursor: "99",
    });

    expect(section).not.toBeNull();
    expect(section!.chunks).toEqual([]);
    expect(section!.nextCursor).toBeUndefined();
  });

  it("returns no matches for an empty pattern, a non-positive limit or an unusable matcher", () => {
    expect(findInFileVectorIndex(notesState, { pattern: "", mode: "literal", limit: 10 })).toEqual({
      items: [],
    });
    expect(
      findInFileVectorIndex(notesState, { pattern: "Alpha", mode: "literal", limit: 0 }),
    ).toEqual({ items: [] });
    expect(
      findInFileVectorIndex(notesState, { pattern: "(unclosed", mode: "regex", limit: 10 }),
    ).toEqual({ items: [] });
  });

  it("returns nothing when summarizing or outlining an unknown source", () => {
    expect(getFileVectorIndexSourceOutline(notesState, "Notes/missing.md")).toBeNull();
    expect(summarizeFileVectorIndexSource(notesState, "Notes/missing.md", 5)).toBeNull();
    expect(summarizeFileVectorIndexSource(notesState, "Notes/a.md", -3)!.sections).toEqual([]);
  });
});

describe("index inventory over partially written state", () => {
  it("derives the source path of legacy rows that predate the sourcePath field", () => {
    const legacyState = stateOf(
      [
        chunk({ id: "old-1", sourcePath: "Notes/legacy.md", text: "Legacy body", legacy: true }),
        chunk({ id: "new-1", sourcePath: "Notes/legacy.md", text: "Fresh body", chunkIndex: 1 }),
      ],
      [source({ sourcePath: "Notes/legacy.md", chunkCount: 2 })],
    );

    const chunks = listFileVectorIndexChunks(legacyState, {
      sourcePath: "Notes/legacy.md",
      limit: 10,
    });
    const outline = getFileVectorIndexSourceOutline(legacyState, "Notes/legacy.md");
    const matches = findInFileVectorIndex(legacyState, {
      pattern: "body",
      mode: "literal",
      limit: 10,
      sourcePath: "Notes/legacy.md",
    });

    expect(chunks.items.map((item) => item.chunkId)).toEqual(["old-1", "new-1"]);
    expect(chunks.items[0]!.chunkIndex).toBe(0);
    expect(outline!.chunkCount).toBe(2);
    expect(matches.items).toHaveLength(2);
  });

  it("hides sources whose last indexing run failed", () => {
    const partialState = stateOf(notesChunks, [
      source({ sourcePath: "Notes/a.md", chunkCount: 2 }),
      source({ sourcePath: "Notes/broken.md", failed: true, errorMessage: "unreadable" }),
    ]);

    expect(
      listFileVectorIndexSources(partialState, { limit: 10 }).items.map((item) => item.sourcePath),
    ).toEqual(["Notes/a.md"]);
  });

  it("falls back to the snapshot path and document kind when no chunk was written", () => {
    const pendingState = stateOf([], [source({ sourcePath: "Notes/pending.md", chunkCount: 0 })]);

    expect(listFileVectorIndexSources(pendingState, { limit: 10 }).items[0]).toMatchObject({
      sourcePath: "Notes/pending.md",
      title: "Notes/pending.md",
      kind: "document",
    });
  });

  it("filters sources by kind, path prefix and query without matching failed ones", () => {
    const filtered = listFileVectorIndexSources(notesState, {
      limit: 10,
      kind: "pdf",
    });
    const byPrefix = listFileVectorIndexSources(notesState, { limit: 10, pathPrefix: "Books/" });
    const byQuery = listFileVectorIndexSources(notesState, { limit: 10, query: "ALPHA" });

    expect(filtered.items).toEqual([]);
    expect(byPrefix.items).toEqual([]);
    expect(byQuery.items).toEqual([]);
  });

  it("rejects metadata searches whose extension, language, title or date do not match", () => {
    const withLanguage = stateOf(notesChunks, [
      source({ sourcePath: "Notes/a.md", chunkCount: 2, languages: ["en"] }),
    ]);

    expect(
      searchFileVectorIndexByMetadata(withLanguage, { limit: 10, extension: ".pdf" }).items,
    ).toEqual([]);
    expect(
      searchFileVectorIndexByMetadata(withLanguage, { limit: 10, language: "ru" }).items,
    ).toEqual([]);
    expect(
      searchFileVectorIndexByMetadata(withLanguage, { limit: 10, title: "missing" }).items,
    ).toEqual([]);
    expect(
      searchFileVectorIndexByMetadata(withLanguage, {
        limit: 10,
        indexedAfter: "2027-01-01T00:00:00.000Z",
      }).items,
    ).toEqual([]);
    expect(
      searchFileVectorIndexByMetadata(withLanguage, { limit: 10, heading: "nowhere" }).items,
    ).toEqual([]);
    expect(
      searchFileVectorIndexByMetadata(withLanguage, {
        limit: 10,
        extension: "md",
        language: "en",
        title: "notes/a",
        heading: "beta",
      }).items.map((item) => item.sourcePath),
    ).toEqual(["Notes/a.md"]);
  });

  it("excludes chunks whose heading path does not start with the requested one", () => {
    const filtered = listFileVectorIndexChunks(notesState, {
      sourcePath: "Notes/a.md",
      limit: 10,
      headingPath: ["Chapter"],
    });
    const unmatched = listFileVectorIndexChunks(notesState, {
      sourcePath: "Notes/a.md",
      limit: 10,
      headingPath: ["Other"],
    });

    expect(filtered.items.map((item) => item.chunkId)).toEqual(["c-2"]);
    expect(unmatched.items).toEqual([]);
  });

  it("stops copying neighbour text once the character budget is exhausted", () => {
    const longState = stateOf(
      [
        chunk({ id: "l-1", sourcePath: "Notes/long.md", text: "A".repeat(40), chunkIndex: 0 }),
        chunk({ id: "l-2", sourcePath: "Notes/long.md", text: "B".repeat(40), chunkIndex: 1 }),
        chunk({ id: "l-3", sourcePath: "Notes/long.md", text: "C".repeat(40), chunkIndex: 2 }),
      ],
      [source({ sourcePath: "Notes/long.md", chunkCount: 3 })],
    );

    const result = readFileVectorIndexChunk(longState, {
      chunkId: "l-1",
      before: 0,
      after: 2,
      maxChars: 40,
    });

    expect(result.chunks.map((item) => item.chunkId)).toEqual(["l-1"]);
    expect(result.chunks[0]!.truncated).toBe(false);
  });
});
