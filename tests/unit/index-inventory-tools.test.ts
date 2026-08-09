import {
  FindInIndexTool,
  FindClaimsTool,
  ListIndexSourcesTool,
  ListIndexChunksTool,
  ReadIndexSectionTool,
  SearchIndexByMetadataTool,
} from "@adapters/research-tools/index/IndexInventoryTools";
import { ResearchRetriever } from "@application/contracts";
import { executeTool } from "@core/agent";

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

  it("reports unavailable inventory capabilities instead of invoking them", async () => {
    const retriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    } as ResearchRetriever;

    await expect(
      executeTool(new ListIndexSourcesTool(retriever), {
        id: "call-unsupported",
        name: "list_index_sources",
        arguments: {},
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "index-inventory-unsupported" } });
  });

  it("keeps a missing section distinguishable from an empty one", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
      readIndexSection: vi.fn().mockResolvedValue(null),
    };

    await expect(
      executeTool(new ReadIndexSectionTool(retriever), {
        id: "call-section",
        name: "read_index_section",
        arguments: { chunkId: "chunk-missing", maxChars: 500 },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { section: null, diagnostics: { resultCount: 0, limit: 500 } },
    });
  });

  it("passes metadata filters through and returns their count without exposing page items", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
      searchIndexByMetadata: vi.fn().mockResolvedValue({ items: [{ sourcePath: "Papers/a.pdf" }] }),
    };

    const result = await executeTool(new SearchIndexByMetadataTool(retriever), {
      id: "call-metadata",
      name: "search_index_by_metadata",
      arguments: { sourceKind: "pdf", extension: "pdf", countOnly: true, limit: 5 },
    });

    expect(retriever.searchIndexByMetadata).toHaveBeenCalledWith({
      sourceKind: "pdf",
      extension: "pdf",
      countOnly: true,
      limit: 5,
    });
    expect(result).toMatchObject({ ok: true, value: { count: 1 } });
  });

  it("omits empty claim filters while retaining the bounded result limit", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
      findClaims: vi.fn().mockResolvedValue([]),
    };

    await executeTool(new FindClaimsTool(retriever), {
      id: "call-claims",
      name: "find_claims",
      arguments: { subject: "  ", topic: "methods", limit: 500 },
    });

    expect(retriever.findClaims).toHaveBeenCalledWith({ topic: "methods", limit: 100 });
  });
});
