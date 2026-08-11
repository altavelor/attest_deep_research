import { describe, expect, it, vi } from "vitest";

import { FileVectorIndexReader } from "@adapters/indexing";

import { MemoryFileSystem } from "../helpers/memoryFileSystem";

function reader(rows: Array<Record<string, unknown>>) {
  const state = {
    withState: vi.fn(async (_fallback: unknown, read: (value: unknown) => unknown) =>
      read({ manifest: {}, chunksByShard: new Map([["a", rows.map((row) => ({ row }))]]) }),
    ),
  };
  return {
    reader: new FileVectorIndexReader(state as never, {
      fileSystem: new MemoryFileSystem(),
      pathFor: (path) => `.attest/index/${path}`,
    }),
    state,
  };
}

describe("FileVectorIndexReader inventory", () => {
  const row = (id: string, sourcePath: string, chunkIndex: number) => ({
    id,
    sourcePath,
    chunkIndex,
    source: {
      id: `source-${id}`,
      kind: "document",
      path: sourcePath,
      title: sourcePath,
      format: "txt",
    },
    text: id,
    contentHash: `hash-${id}`,
  });

  it("orders chunks by source and position, then supplies a continuation cursor", async () => {
    const { reader: index } = reader([
      row("later", "B.md", 0),
      row("second", "A.md", 1),
      row("first", "A.md", 0),
    ]);

    await expect(index.listIndexedChunks({ limit: 2 })).resolves.toMatchObject({
      chunks: [
        { id: "first", score: 1 },
        { id: "second", score: 1 },
      ],
      nextCursor: "2",
    });
    await expect(index.listIndexedChunks({ limit: 2, cursor: "2" })).resolves.toMatchObject({
      chunks: [{ id: "later" }],
    });
  });

  it("filters by source and treats invalid cursors or nonpositive limits safely", async () => {
    const { reader: index, state } = reader([row("a", "A.md", 0), row("b", "B.md", 0)]);

    await expect(
      index.listIndexedChunks({ limit: 10, sourcePath: "B.md", cursor: "bad" }),
    ).resolves.toMatchObject({
      chunks: [{ id: "b" }],
    });
    await expect(index.listIndexedChunks({ limit: 0 })).resolves.toEqual({ chunks: [] });
    expect(state.withState).toHaveBeenCalledTimes(1);
  });
});
