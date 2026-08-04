import { IndexResearchTool } from "@adapters/research-tools/index/IndexResearchTool";
import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { executeTool } from "@core/agent";
import { IxplorerError } from "@core/errors";
import { ResearchRetriever } from "@application/contracts";
import { markdownSource, retrieved } from "../helpers/factories";

describe("IndexResearchTool", () => {
  it("searches the selected retriever without web or query expansion and registers visible chunks", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({
        chunks: [
          retrieved("chunk-a", markdownSource("Notes/A.md"), "First result"),
          retrieved("chunk-b", markdownSource("Notes/Visible.md"), "x".repeat(1_200)),
        ],
        citations: [],
        usedFallback: false,
      }),
    };
    const registry = new ResearchEvidenceRegistry();
    const tool = new IndexResearchTool({ retriever, evidence: registry });

    const execution = await executeTool(tool, {
      id: "call-1",
      name: "search_index",
      arguments: { query: "  local   research  ", limit: 9 },
    });

    expect(retriever.search).toHaveBeenCalledWith("local research", {
      limit: 5,
      includeWebResults: false,
    });
    expect(execution).toMatchObject({
      ok: true,
      value: {
        query: "local research",
        results: [
          { evidenceId: "chunk-a", chunkId: "chunk-a", path: "Notes/A.md" },
          { evidenceId: "chunk-b", chunkId: "chunk-b", path: "Notes/Visible.md" },
        ],
      },
    });
    if (execution.ok) {
      expect(execution.value.results[1]?.snippet.length).toBe(1_000);
    }
    expect(registry.snapshot().evidence.map((item) => item.id)).toEqual(["chunk-a", "chunk-b"]);
  });

  it("returns successful empty results", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    };
    const tool = new IndexResearchTool({ retriever, evidence: new ResearchEvidenceRegistry() });

    await expect(
      executeTool(tool, {
        id: "call-empty",
        name: "search_index",
        arguments: { query: "nothing" },
      }),
    ).resolves.toMatchObject({ ok: true, value: { results: [] } });
  });

  it("maps retriever failures to a uniform retryable error", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockRejectedValue(new Error("secret provider detail")),
    };
    const tool = new IndexResearchTool({ retriever, evidence: new ResearchEvidenceRegistry() });

    await expect(
      executeTool(tool, {
        id: "call-failed",
        name: "search_index",
        arguments: { query: "research" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "index-search-failed",
        message: "Index search failed.",
        retryable: true,
      },
    });
  });

  it("rejects an empty or blank query before reaching the retriever", async () => {
    const retriever: ResearchRetriever = { search: vi.fn() };
    const tool = new IndexResearchTool({ retriever, evidence: new ResearchEvidenceRegistry() });

    for (const query of ["", "   ", "\n\t", 42, null, undefined]) {
      await expect(
        executeTool(tool, {
          id: "call-empty-query",
          name: "search_index",
          arguments: { query },
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "missing-query" } });
    }
    expect(retriever.search).not.toHaveBeenCalled();
  });

  it("rejects malformed scoping arguments without calling the retriever", async () => {
    const retriever: ResearchRetriever = { search: vi.fn() };
    const tool = new IndexResearchTool({ retriever, evidence: new ResearchEvidenceRegistry() });

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ query: "q", sourcePath: 7 }, "invalid-source-path"],
      [{ query: "q", sourcePath: "x".repeat(501) }, "invalid-source-path"],
      [{ query: "q", language: 7 }, "invalid-language"],
      [{ query: "q", language: "x".repeat(41) }, "invalid-language"],
      [{ query: "q", diversify: "yes" }, "invalid-diversify"],
      [{ query: "q", limit: 1.5 }, "invalid-limit"],
      [{ query: "x".repeat(241) }, "query-too-long"],
      [{ query: "q", unexpected: true }, "unknown-property"],
    ];

    for (const [args, code] of cases) {
      await expect(
        executeTool(tool, { id: "call-invalid", name: "search_index", arguments: args }),
      ).resolves.toMatchObject({ ok: false, error: { code } });
    }
    expect(retriever.search).not.toHaveBeenCalled();
  });

  it("hides the failure detail when the selected index is missing", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockRejectedValue(
        new IxplorerError({
          code: "INDEX_UNAVAILABLE",
          message: "No index at /Users/someone/vault/.ixplorer.",
        }),
      ),
    };
    const tool = new IndexResearchTool({ retriever, evidence: new ResearchEvidenceRegistry() });

    const execution = await executeTool(tool, {
      id: "call-missing-index",
      name: "search_index",
      arguments: { query: "research" },
    });

    expect(execution).toMatchObject({
      ok: false,
      error: { code: "index-search-failed", retryable: true },
    });
    expect(JSON.stringify(execution)).not.toContain("/Users/someone");
  });

  it("reports a degraded semantic search as a diagnostic rather than a failure", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({
        chunks: [retrieved("chunk-a", markdownSource("Notes/A.md"), "First result")],
        citations: [],
        usedFallback: true,
        semanticError: "embedding model unavailable",
      }),
    };
    const tool = new IndexResearchTool({
      retriever,
      evidence: new ResearchEvidenceRegistry(),
    });

    await expect(
      executeTool(tool, { id: "call-degraded", name: "search_index", arguments: { query: "q" } }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        diagnostics: {
          usedKeywordFallback: true,
          semanticError: "embedding model unavailable",
        },
      },
      diagnostic: { usedKeywordFallback: true, semanticError: "embedding model unavailable" },
    });
  });
});
