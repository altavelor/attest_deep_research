import { FindInIndexTool, ListIndexChunksTool } from "../../src/adapters/research-tools/index/IndexInventoryTools";
import { ResearchRetriever } from "../../src/application/contracts/research";
import { executeTool } from "../../src/core/agent/tool";

describe("IndexInventoryTools", () => {
  it("parses list_index_chunks input and delegates to the retriever", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
      listIndexChunks: vi.fn().mockResolvedValue({
        items: [{ chunkId: "chunk-a", sourcePath: "Books/book.md" }],
        nextCursor: "1",
      }),
    };
    const tool = new ListIndexChunksTool(retriever);

    const result = await executeTool(tool, {
      id: "call-1",
      name: "list_index_chunks",
      arguments: {
        sourcePath: " Books/book.md ",
        headingPath: ["Chapter 1"],
        limit: 500,
      },
    });

    expect(retriever.listIndexChunks).toHaveBeenCalledWith({
      sourcePath: "Books/book.md",
      headingPath: ["Chapter 1"],
      limit: 50,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [{ chunkId: "chunk-a" }],
        nextCursor: "1",
        diagnostics: { resultCount: 1, limit: 50, untrustedEvidence: true },
      },
    });
  });

  it("rejects unknown properties for exact index search", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
      findInIndex: vi.fn(),
    };
    const tool = new FindInIndexTool(retriever);

    await expect(
      executeTool(tool, {
        id: "call-2",
        name: "find_in_index",
        arguments: { pattern: "TODO", mode: "literal", extra: true },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "unknown-property" },
    });
    expect(retriever.findInIndex).not.toHaveBeenCalled();
  });

  it("returns only the total count when countOnly is set", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
      findInIndex: vi.fn().mockResolvedValue({
        items: [{ chunkId: "chunk-a" }],
        nextCursor: "1",
        totalCount: 42,
      }),
    };
    const tool = new FindInIndexTool(retriever);

    const result = await executeTool(tool, {
      id: "call-3",
      name: "find_in_index",
      arguments: { pattern: "TODO", mode: "literal", countOnly: true, limit: 10 },
    });

    expect(result).toMatchObject({ ok: true, value: { count: 42 } });
    expect((result as { value: Record<string, unknown> }).value).not.toHaveProperty("items");
  });
});
