import { CheckUrlsTool, ListIndexUrlsTool } from "@adapters/research-tools/index/IndexUrlTools";
import { executeTool } from "@core/agent";
import type { ResearchRetriever, UrlStatusChecker } from "@application/contracts";
import { markdownSource } from "../helpers/factories";

describe("index URL tools", () => {
  it("lists indexed URLs with pagination inputs clamped to the tool maximum", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn(),
      listIndexedUrls: vi.fn().mockResolvedValue({
        items: [
          {
            id: "url-1",
            url: "https://example.com/docs",
            normalizedUrl: "https://example.com/docs",
            purpose: "official documentation",
            context: "See the official documentation at https://example.com/docs.",
            chunkId: "chunk-1",
            source: markdownSource("Books/Book.md", ["Chapter 1"]),
          },
        ],
        nextCursor: "1",
      }),
    };
    const tool = new ListIndexUrlsTool(retriever);

    const execution = await executeTool(tool, {
      id: "call-urls",
      name: "list_index_urls",
      arguments: { limit: 500, sourcePath: " Books/Book.md " },
    });

    expect(retriever.listIndexedUrls).toHaveBeenCalledWith({
      limit: 100,
      sourcePath: "Books/Book.md",
    });
    expect(execution).toMatchObject({
      ok: true,
      value: {
        items: [{ url: "https://example.com/docs", purpose: "official documentation" }],
        nextCursor: "1",
        diagnostics: { resultCount: 1, limit: 100, untrustedEvidence: true },
      },
    });
  });

  it("defaults URL inventory to the single attached index source", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn(),
      listIndexedUrls: vi.fn().mockResolvedValue({ items: [] }),
    };
    const tool = new ListIndexUrlsTool(retriever, {
      allowedSourcePaths: ["Books/Attached.pdf"],
    });

    await executeTool(tool, {
      id: "call-scoped",
      name: "list_index_urls",
      arguments: { limit: 10 },
    });

    expect(retriever.listIndexedUrls).toHaveBeenCalledWith({
      limit: 10,
      sourcePath: "Books/Attached.pdf",
    });
  });

  it("rejects URL inventory outside the attached index source scope", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn(),
      listIndexedUrls: vi.fn(),
    };
    const tool = new ListIndexUrlsTool(retriever, {
      allowedSourcePaths: ["Books/Attached.pdf"],
    });

    await expect(
      executeTool(tool, {
        id: "call-out-of-scope",
        name: "list_index_urls",
        arguments: { sourcePath: "Books/Other.pdf" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "source-path-out-of-scope" },
    });
    expect(retriever.listIndexedUrls).not.toHaveBeenCalled();
  });

  it("checks URL reachability through the injected checker", async () => {
    const checker: UrlStatusChecker = {
      checkUrls: vi.fn().mockResolvedValue([
        {
          url: "https://example.com",
          state: "reachable",
          ok: true,
          status: 200,
          finalUrl: "https://example.com/",
        },
      ]),
    };
    const tool = new CheckUrlsTool(checker);

    const execution = await executeTool(tool, {
      id: "call-check",
      name: "check_urls",
      arguments: { urls: ["https://example.com"], timeoutMs: 500 },
    });

    expect(checker.checkUrls).toHaveBeenCalledWith(
      [{ url: "https://example.com" }],
      expect.objectContaining({ timeoutMs: 1_000 }),
    );
    expect(execution).toMatchObject({
      ok: true,
      value: {
        results: [{ url: "https://example.com", state: "reachable", ok: true, status: 200 }],
        diagnostics: { checkedCount: 1, timeoutMs: 1_000 },
      },
    });
  });

  it("reports an index that cannot list URLs instead of returning an empty inventory", async () => {
    const retriever: ResearchRetriever = { search: vi.fn() };
    const tool = new ListIndexUrlsTool(retriever);

    await expect(
      executeTool(tool, { id: "call-unsupported", name: "list_index_urls", arguments: {} }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "index-url-inventory-unsupported" },
    });
  });

  it("maps an inventory failure to a uniform retryable error without leaking detail", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn(),
      listIndexedUrls: vi.fn().mockRejectedValue(new Error("sqlite at /Users/someone/vault")),
    };
    const tool = new ListIndexUrlsTool(retriever);

    const execution = await executeTool(tool, {
      id: "call-failed",
      name: "list_index_urls",
      arguments: {},
    });

    expect(execution).toMatchObject({
      ok: false,
      error: { code: "index-url-inventory-failed", retryable: true },
    });
    expect(JSON.stringify(execution)).not.toContain("/Users/someone");
  });

  it("rejects malformed inventory arguments without touching the retriever", async () => {
    const retriever: ResearchRetriever = { search: vi.fn(), listIndexedUrls: vi.fn() };
    const tool = new ListIndexUrlsTool(retriever);

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ cursor: 7 }, "invalid-cursor"],
      [{ cursor: "x".repeat(201) }, "invalid-cursor"],
      [{ sourcePath: 7 }, "invalid-source-path"],
      [{ sourcePath: "x".repeat(501) }, "invalid-source-path"],
      [{ limit: "10" }, "invalid-limit"],
      [{ limit: 2.5 }, "invalid-limit"],
      [{ unexpected: true }, "unknown-property"],
    ];

    for (const [args, code] of cases) {
      await expect(
        executeTool(tool, { id: "call-invalid", name: "list_index_urls", arguments: args }),
      ).resolves.toMatchObject({ ok: false, error: { code } });
    }
    expect(retriever.listIndexedUrls).not.toHaveBeenCalled();
  });

  it("requires an explicit sourcePath when several index sources are attached", async () => {
    const retriever: ResearchRetriever = { search: vi.fn(), listIndexedUrls: vi.fn() };
    const tool = new ListIndexUrlsTool(retriever, {
      allowedSourcePaths: ["Books/A.pdf", "Books/B.pdf"],
    });

    await expect(
      executeTool(tool, { id: "call-ambiguous", name: "list_index_urls", arguments: {} }),
    ).resolves.toMatchObject({ ok: false, error: { code: "source-path-required" } });
    expect(retriever.listIndexedUrls).not.toHaveBeenCalled();
  });

  it("rejects malformed URL-check arguments without calling the checker", async () => {
    const checker: UrlStatusChecker = { checkUrls: vi.fn() };
    const tool = new CheckUrlsTool(checker);

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ urls: [] }, "invalid-urls"],
      [{ urls: "https://example.com" }, "invalid-urls"],
      [{ urls: [42] }, "invalid-urls"],
      [{ urls: ["  "] }, "invalid-urls"],
      [{ urls: ["https://example.com"], timeoutMs: "500" }, "invalid-timeout"],
      [{ urls: ["https://example.com"], unexpected: true }, "unknown-property"],
    ];

    for (const [args, code] of cases) {
      await expect(
        executeTool(tool, { id: "call-invalid-check", name: "check_urls", arguments: args }),
      ).resolves.toMatchObject({ ok: false, error: { code } });
    }
    expect(checker.checkUrls).not.toHaveBeenCalled();
  });

  it("maps a throwing URL checker to a uniform retryable error", async () => {
    const checker: UrlStatusChecker = {
      checkUrls: vi.fn().mockRejectedValue(new Error("socket hang up at 10.0.0.1")),
    };
    const tool = new CheckUrlsTool(checker);

    const execution = await executeTool(tool, {
      id: "call-check-failed",
      name: "check_urls",
      arguments: { urls: ["https://example.com"] },
    });

    expect(execution).toMatchObject({
      ok: false,
      error: { code: "url-check-failed", retryable: true },
    });
    expect(JSON.stringify(execution)).not.toContain("10.0.0.1");
  });
});
