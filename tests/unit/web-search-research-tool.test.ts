import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { executeTool } from "@core/agent";
import { WebSearchResearchTool } from "@adapters/research-tools/web/WebSearchResearchTool";
import { SearchProvider, WebSearchOptions } from "@application/ports";
import type { WebSourceSelectionDiagnostics } from "@core/diagnostics";

describe("WebSearchResearchTool", () => {
  it("performs metadata-only search and collapses canonical duplicate URLs", async () => {
    const provider: SearchProvider = {
      search: vi
        .fn()
        .mockResolvedValue([
          webResult("https://Example.com:443/research#one", "First", "First snippet", 1),
          webResult("https://example.com/research#two", "Duplicate", "Other snippet", 2),
        ]),
    };
    const registry = new ResearchEvidenceRegistry({ createHandle: () => "opaque-result" });
    const tool = new WebSearchResearchTool({ provider, evidence: registry });

    const execution = await executeTool(tool, {
      id: "call-web",
      name: "search_web",
      arguments: { query: "  current   research  ", limit: 5 },
    });

    expect(provider.search).toHaveBeenCalledWith(
      "current research",
      expect.objectContaining({ mode: "thinking", limit: 5, maxFetches: 0 }),
    );
    expect(execution).toMatchObject({
      ok: true,
      value: {
        results: [
          {
            resultId: "opaque-result",
            url: "https://example.com/research",
            title: "First",
            snippet: "First snippet",
          },
        ],
        diagnostics: { duplicateCount: 1, untrustedEvidence: true },
      },
    });
    expect(registry.snapshot().evidence).toHaveLength(1);
    expect(registry.snapshot().provenance[0]?.calls).toEqual([
      { callId: "call-web", query: "current research", tool: "search_web" },
    ]);
  });

  it("returns successful empty results and maps provider failures", async () => {
    const provider: SearchProvider = { search: vi.fn().mockResolvedValue([]) };
    const tool = new WebSearchResearchTool({
      provider,
      evidence: new ResearchEvidenceRegistry(),
    });

    await expect(
      executeTool(tool, {
        id: "empty",
        name: "search_web",
        arguments: { query: "nothing" },
      }),
    ).resolves.toMatchObject({ ok: true, value: { results: [] } });

    vi.mocked(provider.search).mockRejectedValue(new Error("network detail"));
    await expect(
      executeTool(tool, {
        id: "failed",
        name: "search_web",
        arguments: { query: "research" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "web-search-failed", message: "Web search failed.", retryable: true },
    });
  });
});

function webResult(url: string, title: string, snippet: string, rank: number) {
  return {
    source: {
      id: `web:${url}`,
      kind: "web" as const,
      title,
      url,
      snippet,
      retrievedAt: "2026-06-20T00:00:00.000Z",
      wasContentFetched: false,
    },
    rank,
    query: "current research",
  };
}

describe("WebSearchResearchTool source-selection tracing", () => {
  function tracingProvider(captured: WebSearchOptions[]): SearchProvider {
    return {
      search: async (_query, options) => {
        captured.push(options ?? {});
        options?.onSourceSelection?.({
          mode: "thinking",
          deadlineMs: options.deadlineMs ?? 0,
          perSourceLimit: options.perSourceLimit ?? 0,
          deadlineExceeded: false,
          cancelled: false,
          intent: "academic",
          intentOrigin: "model",
          sources: [
            {
              sourceId: "arxiv",
              label: "arXiv",
              activation: "auto",
              outcome: "queried",
              queryOrder: 1,
              returnedResults: 1,
            },
          ],
        });
        return [];
      },
    };
  }

  it("passes the mode's web parameters to the provider", async () => {
    const captured: WebSearchOptions[] = [];
    const tool = new WebSearchResearchTool({
      provider: tracingProvider(captured),
      evidence: new ResearchEvidenceRegistry(),
      web: {
        deadlineMs: 12_000,
        perSourceLimit: 4,
        mergedLimit: 15,
        maxConcurrentSources: 3,
      },
    });

    await executeTool(tool, {
      id: "call-web",
      name: "search_web",
      arguments: { query: "rag papers", limit: 5 },
    });

    expect(captured[0]).toMatchObject({
      deadlineMs: 12_000,
      perSourceLimit: 4,
      maxConcurrentSources: 3,
      limit: 5,
    });
  });

  it("reports each search's source selection tagged with its query", async () => {
    const seen: WebSourceSelectionDiagnostics[] = [];
    const tool = new WebSearchResearchTool({
      provider: tracingProvider([]),
      evidence: new ResearchEvidenceRegistry(),
      onSourceSelection: (selection) => seen.push(selection),
    });

    await executeTool(tool, {
      id: "call-web",
      name: "search_web",
      arguments: { query: "rag papers", limit: 5 },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      query: "rag papers",
      intent: "academic",
      intentOrigin: "model",
    });
    expect(seen[0].sources[0]).toMatchObject({ sourceId: "arxiv", outcome: "queried" });
  });

  it("omits the selection callback when no sink is wired", async () => {
    const captured: WebSearchOptions[] = [];
    const tool = new WebSearchResearchTool({
      provider: tracingProvider(captured),
      evidence: new ResearchEvidenceRegistry(),
    });

    await executeTool(tool, {
      id: "call-web",
      name: "search_web",
      arguments: { query: "rag papers", limit: 5 },
    });

    expect(captured[0].onSourceSelection).toBeUndefined();
  });
});
