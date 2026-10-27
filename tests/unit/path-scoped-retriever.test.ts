import { describe, expect, it } from "vitest";

import type { ResearchRetriever } from "@application/contracts/research";
import { pathScopedRetriever } from "@application/use-cases/research/sub-agent/pathScopedRetriever";

const FOREIGN = ["Notes/a.md/child.md", "Other/x.md"];

/**
 * A retriever that ignores every scope: each read answers for all of its documents, each
 * page carries a cursor and a count, and the options of every call are recorded.
 */
function unscopedRetriever(paths: readonly string[]) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, options: unknown): void => void (calls[name] ??= []).push(options);
  const items = () => paths.map((sourcePath) => ({ sourcePath, chunkId: sourcePath }));
  const page = (name: string) => async (options: unknown) => {
    record(name, options);
    return { items: items(), nextCursor: "next", totalCount: paths.length };
  };
  const chunk = (path: string) => ({
    id: `c-${path}`,
    text: "t",
    contentHash: path,
    score: 1,
    source: { id: path, kind: "markdown", title: path, path, headingPath: [] },
  });
  const document = async (path: string) => ({ sourcePath: path });
  const retriever = {
    search: async (_query: string, options: unknown) => {
      record("search", options);
      const chunks = paths.map(chunk);
      return { chunks, citations: chunks.map(({ id }) => ({ id })), usedFallback: false };
    },
    getLanguageInventory: async () => ["en"],
    listIndexedUrls: async () => ({ items: paths.map((path) => ({ source: { path } })) }),
    listIndexSources: page("listIndexSources"),
    searchIndexByMetadata: page("searchIndexByMetadata"),
    listIndexChunks: page("listIndexChunks"),
    findInIndex: page("findInIndex"),
    readIndexChunk: async () => ({ chunks: items() }),
    readIndexSection: async ({ chunkId }: { chunkId: string }) => ({ sourcePath: chunkId }),
    getSourceMetadata: document,
    getSourceSummary: document,
    summarizeIndexSource: document,
    getIndexSourceOutline: document,
  } as unknown as ResearchRetriever;
  return { retriever, calls };
}

describe("pathScopedRetriever", () => {
  it("confines every read of an exact scope to the granted document and hides other pages", async () => {
    const { retriever, calls } = unscopedRetriever(["Notes/a.md", ...FOREIGN]);
    const scoped = pathScopedRetriever(retriever, ["Notes/a.md"], true);
    const only = { items: [{ sourcePath: "Notes/a.md", chunkId: "Notes/a.md" }] };

    const search = await scoped.search("q", {
      limit: 5,
      includeWebResults: false,
      sourcePaths: ["Notes/a.md", "Other/x.md"],
    });
    expect([search.chunks.map((entry) => entry.id), search.citations]).toEqual([
      ["c-Notes/a.md"],
      [{ id: "c-Notes/a.md" }],
    ]);
    expect(calls.search).toEqual([expect.objectContaining({ sourcePaths: ["Notes/a.md"] })]);
    expect(scoped.getLanguageInventory).toBeUndefined();
    expect((await scoped.listIndexedUrls!({ limit: 5 } as never)).items).toEqual([
      { source: { path: "Notes/a.md" } },
    ]);
    expect(await scoped.listIndexedUrls!({ limit: 5, sourcePath: "Other/x.md" } as never)).toEqual({
      items: [],
    });
    expect(await scoped.listIndexSources!({ limit: 5 })).toEqual(only);
    expect(await scoped.searchIndexByMetadata!({ limit: 5 })).toEqual(only);
    expect([calls.listIndexSources, calls.searchIndexByMetadata]).toEqual([
      [{ limit: 5, pathPrefix: "Notes/a.md" }],
      [{ limit: 5, pathPrefix: "Notes/a.md" }],
    ]);
    expect(await scoped.findInIndex!({ pattern: "x", mode: "literal", limit: 5 })).toEqual(only);
    expect(calls.findInIndex).toEqual([expect.objectContaining({ sourcePath: "Notes/a.md" })]);
    const findForeign = {
      pattern: "x",
      mode: "literal" as const,
      limit: 5,
      sourcePath: FOREIGN[1],
    };
    expect(await scoped.findInIndex!(findForeign)).toEqual({ items: [] });
    for (const sourcePath of [...FOREIGN, "Notes/a.md/"]) {
      expect(await scoped.listIndexChunks!({ sourcePath, limit: 5 })).toEqual({ items: [] });
      expect(await scoped.readIndexSection!({ chunkId: sourcePath, maxChars: 9 })).toBeNull();
      expect(
        await Promise.all([
          scoped.getSourceMetadata!(sourcePath),
          scoped.getSourceSummary!(sourcePath),
          scoped.summarizeIndexSource!(sourcePath, 3),
          scoped.getIndexSourceOutline!(sourcePath),
        ]),
      ).toEqual([null, null, null, null]);
    }
    expect(calls.listIndexChunks).toBeUndefined();
    expect(await scoped.listIndexChunks!({ sourcePath: "Notes/a.md", limit: 5 })).toMatchObject({
      nextCursor: "next",
    });
    expect(
      await scoped.readIndexChunk!({ chunkId: "c", before: 0, after: 0, maxChars: 9 }),
    ).toEqual({ chunks: only.items });
    expect(await scoped.readIndexSection!({ chunkId: "Notes/a.md", maxChars: 9 })).toEqual({
      sourcePath: "Notes/a.md",
    });
    expect(await scoped.getIndexSourceOutline!("Notes/a.md")).toEqual({ sourcePath: "Notes/a.md" });
  });

  it("keeps folder children of a path scope and the cursor of a page narrowed to one granted path", async () => {
    const { retriever, calls } = unscopedRetriever(["Notes/a.md", "Notes/b.md"]);
    const folder = pathScopedRetriever(retriever, ["Notes"]);

    await folder.search("q", { limit: 5, includeWebResults: false });

    expect(calls.search).toEqual([expect.objectContaining({ sourcePaths: ["Notes"] })]);
    expect(await folder.getSourceMetadata!("Notes/a.md")).toEqual({ sourcePath: "Notes/a.md" });
    expect(await folder.findInIndex!({ pattern: "x", mode: "literal", limit: 5 })).toMatchObject({
      nextCursor: "next",
      totalCount: 2,
    });
    const twoFolders = pathScopedRetriever(retriever, ["Notes", "Other"]);
    expect(await twoFolders.listIndexSources!({ limit: 5 })).not.toHaveProperty("nextCursor");
  });
});
