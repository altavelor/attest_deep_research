import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { FileVectorIndexStore, FileVectorInventoryStore } from "@adapters/indexing";
import { EmbeddedChunk, SourceReference } from "@core/model";

describe("readIndexSection (Ф2.1)", () => {
  let folder: string;
  let store: FileVectorIndexStore;
  let inventory: FileVectorInventoryStore;

  beforeEach(async () => {
    folder = mkdtempSync(join(tmpdir(), "ixplorer-section-"));
    store = new FileVectorIndexStore({ folder, profileId: "default" });
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    inventory = new FileVectorInventoryStore(store);
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("returns the contiguous run sharing the hit's heading path", async () => {
    await store.upsert([
      mdChunk("intro", "Notes/tales.md", "Intro text", []),
      mdChunk("riquet-1", "Notes/tales.md", "Riquet part one", ["Riquet with the Tuft"]),
      mdChunk("riquet-2", "Notes/tales.md", "Riquet part two", ["Riquet with the Tuft"]),
      mdChunk("beauty-1", "Notes/tales.md", "Beauty part one", ["The Sleeping Beauty"]),
    ]);

    const section = await inventory.readIndexSection({ chunkId: "riquet-2", maxChars: 20_000 });

    expect(section).not.toBeNull();
    expect(section!.headingPath).toEqual(["Riquet with the Tuft"]);
    expect(section!.chunks.map((chunk) => chunk.chunkId)).toEqual(["riquet-1", "riquet-2"]);
    expect(section!.nextCursor).toBeUndefined();
  });

  it("bounds heading-less sources by title-like chunks", async () => {
    await store.upsert([
      pdfChunk("title-a", "Tales.pdf", "Riquet with the Tuft", 1),
      pdfChunk("body-a1", "Tales.pdf", longText("Once upon a time there was a Queen"), 2),
      pdfChunk("body-a2", "Tales.pdf", longText("The Fairy gave him a gift of wit"), 3),
      pdfChunk("title-b", "Tales.pdf", "The Sleeping Beauty", 4),
      pdfChunk("body-b1", "Tales.pdf", longText("There lived a King and a Queen"), 5),
    ]);

    const section = await inventory.readIndexSection({ chunkId: "body-a2", maxChars: 20_000 });

    expect(section).not.toBeNull();
    expect(section!.headingPath).toEqual([]);
    expect(section!.chunks.map((chunk) => chunk.chunkId)).toEqual([
      "title-a",
      "body-a1",
      "body-a2",
    ]);
  });

  it("caps output by maxChars and continues via cursor", async () => {
    await store.upsert([
      mdChunk("s-1", "Notes/long.md", "A".repeat(120), ["Section"]),
      mdChunk("s-2", "Notes/long.md", "B".repeat(120), ["Section"]),
      mdChunk("s-3", "Notes/long.md", "C".repeat(120), ["Section"]),
    ]);

    const first = await inventory.readIndexSection({ chunkId: "s-1", maxChars: 250 });
    expect(first!.chunks.map((chunk) => chunk.chunkId)).toEqual(["s-1", "s-2", "s-3"]);
    expect(first!.chunks[2].truncated).toBe(true);
    expect(first!.nextCursor).toBe("2");

    const second = await inventory.readIndexSection({
      chunkId: "s-1",
      maxChars: 250,
      cursor: first!.nextCursor,
    });
    expect(second!.chunks.map((chunk) => chunk.chunkId)).toEqual(["s-3"]);
    expect(second!.chunks[0].truncated).toBe(false);
    expect(second!.nextCursor).toBeUndefined();
  });

  it("returns null for unknown chunk ids", async () => {
    await store.upsert([mdChunk("only", "Notes/a.md", "text", [])]);

    await expect(
      inventory.readIndexSection({ chunkId: "missing", maxChars: 100 }),
    ).resolves.toBeNull();
  });
});

function mdChunk(id: string, path: string, text: string, headingPath: string[]): EmbeddedChunk {
  const source: SourceReference = {
    id: `source-${id}`,
    kind: "markdown",
    title: path,
    path,
    headingPath,
  };
  return {
    id,
    source,
    text,
    contentHash: `hash-${id}`,
    embedding: [1, 0],
    embeddingModel: "nomic",
  };
}

function pdfChunk(id: string, path: string, text: string, pageNumber: number): EmbeddedChunk {
  const source: SourceReference = {
    id: `source-${id}`,
    kind: "pdf",
    title: `${path} p. ${pageNumber}`,
    path,
    pageNumber,
  };
  return {
    id,
    source,
    text,
    contentHash: `hash-${id}`,
    embedding: [0, 1],
    embeddingModel: "nomic",
  };
}

function longText(seed: string): string {
  return `${seed}. `.repeat(12);
}
