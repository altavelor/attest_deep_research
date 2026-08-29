import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { WebSearchResearchTool } from "@adapters/research-tools/web/WebSearchResearchTool";
import { executeTool } from "@core/agent";
import { parseWebSearchInput } from "@application/research";
import { SearchProvider } from "@application/ports";

function webResult(url: string, rank: number) {
  return {
    source: {
      id: `web:${url}`,
      kind: "web" as const,
      title: `Title ${rank}`,
      url,
      snippet: `Snippet ${rank}`,
      retrievedAt: "2026-08-29T00:00:00.000Z",
      wasContentFetched: false,
    },
    rank,
    query: "q",
  };
}

function providerFor(byQuery: Record<string, string[]>): SearchProvider {
  return {
    search: vi.fn(async (query: string) =>
      (byQuery[query] ?? []).map((url, index) => webResult(url, index + 1)),
    ),
  };
}

describe("search_web batched queries", () => {
  it("answers several queries in one call and tags each result with its query", async () => {
    const provider = providerFor({
      "apple history": ["https://a.example.com/apple"],
      "microsoft history": ["https://b.example.com/microsoft"],
    });
    const tool = new WebSearchResearchTool({
      provider,
      evidence: new ResearchEvidenceRegistry(),
    });

    const execution = await executeTool(tool, {
      id: "call-batch",
      name: "search_web",
      arguments: { queries: ["apple history", "microsoft history"] },
    });

    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const value = execution.value as {
      queries?: string[];
      query?: string;
      results: Array<{ url: string; query: string }>;
    };
    expect(value.queries).toEqual(["apple history", "microsoft history"]);
    expect(value.query).toBeUndefined();
    expect(value.results.map((result) => [result.url, result.query])).toEqual([
      ["https://a.example.com/apple", "apple history"],
      ["https://b.example.com/microsoft", "microsoft history"],
    ]);
  });

  it("keeps the single-query output shape and tolerates one failing query in a batch", async () => {
    const provider: SearchProvider = {
      search: vi.fn(async (query: string) => {
        if (query === "broken") throw new Error("network");
        return [webResult("https://a.example.com/ok", 1)];
      }),
    };
    const tool = new WebSearchResearchTool({
      provider,
      evidence: new ResearchEvidenceRegistry(),
    });

    const single = await executeTool(tool, {
      id: "call-single",
      name: "search_web",
      arguments: { query: "fine" },
    });
    expect(single).toMatchObject({ ok: true, value: { query: "fine" } });

    const batch = await executeTool(tool, {
      id: "call-mixed",
      name: "search_web",
      arguments: { queries: ["fine", "broken"] },
    });
    expect(batch).toMatchObject({
      ok: true,
      value: { diagnostics: { failedQueryCount: 1, resultCount: 1 } },
    });

    const allBroken = await executeTool(tool, {
      id: "call-broken",
      name: "search_web",
      arguments: { queries: ["broken"] },
    });
    expect(allBroken).toMatchObject({ ok: false, error: { code: "web-search-failed" } });
  });
});

describe("search_web evidence budget diagnostics", () => {
  it("reports an exhausted evidence budget instead of an empty-result retry hint", async () => {
    const registry = new ResearchEvidenceRegistry({ maxWebResults: 1 });
    const provider = providerFor({
      first: ["https://a.example.com/one"],
      second: ["https://b.example.com/two"],
    });
    const tool = new WebSearchResearchTool({ provider, evidence: registry });

    await executeTool(tool, { id: "c1", name: "search_web", arguments: { query: "first" } });
    const execution = await executeTool(tool, {
      id: "c2",
      name: "search_web",
      arguments: { query: "second" },
    });

    expect(execution).toMatchObject({
      ok: true,
      value: {
        results: [],
        diagnostics: { capacityExceededCount: 1, invalidResultCount: 0, resultCount: 0 },
      },
    });
    if (!execution.ok) return;
    const hint = (execution.value as { diagnostics: { hint?: string } }).diagnostics.hint ?? "";
    expect(hint).toMatch(/evidence budget/i);
    expect(hint).not.toMatch(/retry with 2-4 plain keywords/i);
  });

  it("still counts a malformed provider result as invalid, not as exhausted capacity", async () => {
    const provider: SearchProvider = {
      search: vi.fn().mockResolvedValue([{ source: { kind: "web" }, rank: 1 }]),
    };
    const tool = new WebSearchResearchTool({
      provider,
      evidence: new ResearchEvidenceRegistry(),
    });

    const execution = await executeTool(tool, {
      id: "c",
      name: "search_web",
      arguments: { query: "q" },
    });

    expect(execution).toMatchObject({
      ok: true,
      value: { diagnostics: { invalidResultCount: 1, capacityExceededCount: 0 } },
    });
  });
});

describe("parseWebSearchInput batching rules", () => {
  it("accepts a batch, deduplicates it, and rejects malformed batches", () => {
    expect(parseWebSearchInput({ queries: ["  a  b ", "a b", "c"] })).toMatchObject({
      ok: true,
      value: { queries: ["a b", "c"] },
    });
    expect(parseWebSearchInput({ queries: [] })).toMatchObject({
      ok: false,
      error: { code: "invalid-queries" },
    });
    expect(parseWebSearchInput({ queries: ["a", "b", "c", "d", "e"] })).toMatchObject({
      ok: false,
      error: { code: "invalid-queries" },
    });
    expect(parseWebSearchInput({ queries: ["a", ""] })).toMatchObject({
      ok: false,
      error: { code: "invalid-queries" },
    });
    expect(parseWebSearchInput({ queries: ["a", 7] })).toMatchObject({
      ok: false,
      error: { code: "invalid-queries" },
    });
  });

  it("rejects passing both query and queries, and enforces the per-query length cap", () => {
    expect(parseWebSearchInput({ query: "a", queries: ["b"] })).toMatchObject({
      ok: false,
      error: { code: "conflicting-query" },
    });
    expect(parseWebSearchInput({ queries: ["x".repeat(241)] })).toMatchObject({
      ok: false,
      error: { code: "query-too-long" },
    });
    for (const query of [7, null, "   "]) {
      expect(parseWebSearchInput({ query, queries: ["valid"] })).toMatchObject({
        ok: false,
        error: { code: "conflicting-query" },
      });
    }
    expect(parseWebSearchInput({ query: 7 })).toMatchObject({
      ok: false,
      error: { code: "invalid-query" },
    });
  });
});

describe("search_web malformed provider ranks", () => {
  it("drops non-finite and non-positive ranks", async () => {
    const provider: SearchProvider = {
      search: vi
        .fn()
        .mockResolvedValue([
          webResult("https://a.example.com/nan", Number.NaN),
          webResult("https://a.example.com/infinity", Number.POSITIVE_INFINITY),
          webResult("https://a.example.com/negative", -1),
        ]),
    };
    const tool = new WebSearchResearchTool({
      provider,
      evidence: new ResearchEvidenceRegistry(),
    });

    const execution = await executeTool(tool, {
      id: "c",
      name: "search_web",
      arguments: { query: "q" },
    });

    expect(execution).toMatchObject({
      ok: true,
      value: { results: [], diagnostics: { invalidResultCount: 3 } },
    });
  });
});

describe("search_web cancellation and partial failures", () => {
  it("stops the batch on abort and reports cancellation as non-retryable", async () => {
    const controller = new AbortController();
    const provider: SearchProvider = {
      search: vi.fn(async () => {
        controller.abort();
        throw new Error("aborted");
      }),
    };
    const tool = new WebSearchResearchTool({
      provider,
      evidence: new ResearchEvidenceRegistry(),
    });

    const execution = await executeTool(
      tool,
      { id: "c", name: "search_web", arguments: { queries: ["a", "b", "c"] } },
      { signal: controller.signal },
    );

    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(execution).toEqual({
      ok: false,
      error: {
        code: "web-search-cancelled",
        message: "Web search was cancelled.",
        retryable: false,
      },
    });
  });

  it("warns that a partially failed batch leaves sub-questions unverified", async () => {
    const provider: SearchProvider = {
      search: vi.fn(async (query: string) => {
        if (query === "broken") throw new Error("network");
        return [webResult("https://a.example.com/ok", 1)];
      }),
    };
    const tool = new WebSearchResearchTool({
      provider,
      evidence: new ResearchEvidenceRegistry(),
    });

    const execution = await executeTool(tool, {
      id: "c",
      name: "search_web",
      arguments: { queries: ["fine", "broken"] },
    });

    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    const hint = (execution.value as { diagnostics: { hint?: string } }).diagnostics.hint ?? "";
    expect(hint).toMatch(/unverified rather than answered/i);
  });
});
