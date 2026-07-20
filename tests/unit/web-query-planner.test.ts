import {
  classifyWebQuery,
  DUCKDUCKGO_DESCRIPTOR,
  mergeRankedResults,
  selectSourcesForIntent,
  WEB_SOURCE_CATALOG,
  findWebSourceDescriptor,
} from "@core/web";
import { IxplorerError } from "@core/errors";
import { parseWebSearchInput } from "@application/research";
import { SearchProviderResult, WebSearchSource } from "@application/ports";
import { FetchFallbackChain, WebQueryPlanner, WebSourceHealthTracker } from "@application/web";

function result(url: string, rank: number, query = "q"): SearchProviderResult {
  return {
    source: {
      id: `web:${url}`,
      kind: "web",
      title: url,
      url,
      snippet: "",
      retrievedAt: "2026-07-02T00:00:00Z",
      wasContentFetched: false,
    },
    rank,
    query,
  };
}

function fakeSource(id: string, results: SearchProviderResult[] | Error): WebSearchSource {
  const descriptor = findWebSourceDescriptor(id) ?? DUCKDUCKGO_DESCRIPTOR;
  return {
    descriptor: { ...descriptor, id },
    search: () => (results instanceof Error ? Promise.reject(results) : Promise.resolve(results)),
  };
}

describe("classifyWebQuery", () => {
  it.each([
    ["recent arXiv paper on retrieval augmentation", "academic"],
    ["научные исследования сна", "academic"],
    ["TypeError: cannot read properties of undefined in typescript", "code"],
    ["ошибка при установке библиотеки", "code"],
    ["latest Obsidian release news", "news"],
    ["последние новости об ИИ", "news"],
    ["what is reciprocal rank fusion", "encyclopedic"],
    ["что такое эмбеддинг", "encyclopedic"],
    ["best hiking trails near Lisbon", "general"],
  ] as const)("%s → %s", (query, intent) => {
    expect(classifyWebQuery(query)).toBe(intent);
  });
});

describe("selectSourcesForIntent", () => {
  it("prefers intent-matching sources and backfills with general ones", () => {
    const selected = selectSourcesForIntent(WEB_SOURCE_CATALOG, "academic", 3);
    expect(selected.map((descriptor) => descriptor.id)).toEqual([
      "arxiv",
      "semantic-scholar",
      "openalex",
    ]);
  });

  it("falls back to general sources when nothing matches the intent", () => {
    const onlyGeneral = WEB_SOURCE_CATALOG.filter((descriptor) =>
      descriptor.strengths.includes("general"),
    );
    const selected = selectSourcesForIntent(onlyGeneral, "academic", 2);
    expect(selected).toHaveLength(2);
    expect(selected[0].strengths).toContain("general");
  });
});

describe("mergeRankedResults", () => {
  it("deduplicates by normalized URL and boosts cross-source agreement", () => {
    const merged = mergeRankedResults(
      [
        [result("https://a.dev/page/", 1), result("https://b.dev/", 2)],
        [result("https://A.dev/page", 1), result("https://c.dev/", 2)],
      ],
      (item) => item.source.url,
    );

    expect(merged.map((item) => item.source.url)).toEqual([
      "https://a.dev/page/",
      "https://b.dev/",
      "https://c.dev/",
    ]);
  });
});

describe("WebQueryPlanner", () => {
  it("routes academic queries to academic sources and merges with new ranks", async () => {
    const arxiv = fakeSource("arxiv", [result("https://arxiv.org/1", 1)]);
    const scholar = fakeSource("semantic-scholar", [
      result("https://s2.dev/1", 1),
      result("https://arxiv.org/1", 2),
    ]);
    const brave = fakeSource("brave", [result("https://brave-should-not-run.dev/", 1)]);
    const braveSearch = vi.spyOn(brave, "search");

    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave, arxiv, scholar] },
      maxSources: 2,
    });
    const results = await planner.search("arxiv paper on RAG");

    expect(braveSearch).not.toHaveBeenCalled();
    expect(results.map((item) => item.source.url)).toEqual([
      "https://arxiv.org/1",
      "https://s2.dev/1",
    ]);
    expect(results.map((item) => item.rank)).toEqual([1, 2]);
  });

  it("keeps results from healthy sources when one source fails", async () => {
    const failures: string[] = [];
    const planner = new WebQueryPlanner({
      registry: {
        enabledSources: () => [
          fakeSource("brave", new Error("boom")),
          fakeSource("duckduckgo", [result("https://ok.dev/", 1)]),
        ],
      },
      onSourceError: (sourceId) => failures.push(sourceId),
    });

    const results = await planner.search("anything at all");
    expect(results.map((item) => item.source.url)).toEqual(["https://ok.dev/"]);
    expect(failures).toEqual(["brave"]);
  });

  it("returns [] when no sources are enabled and applies the limit option", async () => {
    const empty = new WebQueryPlanner({ registry: { enabledSources: () => [] } });
    await expect(empty.search("query")).resolves.toEqual([]);

    const planner = new WebQueryPlanner({
      registry: {
        enabledSources: () => [
          fakeSource("duckduckgo", [result("https://1.dev/", 1), result("https://2.dev/", 2)]),
        ],
      },
    });
    const limited = await planner.search("query", { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("uses the caller-supplied intent instead of classifying", async () => {
    const arxiv = fakeSource("arxiv", [result("https://arxiv.org/1", 1)]);
    const brave = fakeSource("brave", [result("https://brave.dev/1", 1)]);
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave, arxiv] },
      maxSources: 1,
    });

    // The query itself classifies as general; the explicit intent routes to arXiv.
    const results = await planner.search("consciousness emergence", { intent: "academic" });
    expect(results.map((item) => item.source.url)).toEqual(["https://arxiv.org/1"]);
  });

  it("auto-suspends a source on unauthorized and skips it in later searches", async () => {
    const unauthorized = new IxplorerError({
      code: "WEB_SEARCH_FAILED",
      message: "Brave rejected the credentials.",
      details: { sourceId: "brave", reason: "unauthorized" },
    });
    const brave = fakeSource("brave", unauthorized);
    const braveSearch = vi.spyOn(brave, "search");
    const ddg = fakeSource("duckduckgo", [result("https://ok.dev/", 1)]);

    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave, ddg] },
    });

    await planner.search("first query");
    await planner.search("second query");
    expect(braveSearch).toHaveBeenCalledTimes(1);
  });

  it("suspends rate-limited sources only until the cooldown passes", async () => {
    const rateLimited = new IxplorerError({
      code: "WEB_SEARCH_FAILED",
      message: "Brave rate limit exceeded.",
      details: { sourceId: "brave", reason: "rate-limited" },
    });
    const brave = fakeSource("brave", rateLimited);
    const braveSearch = vi.spyOn(brave, "search");

    let clock = 0;
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave] },
      rateLimitCooldownMs: 1_000,
      now: () => clock,
    });

    await planner.search("q1");
    await planner.search("q2");
    expect(braveSearch).toHaveBeenCalledTimes(1);

    clock = 1_500;
    await planner.search("q3");
    expect(braveSearch).toHaveBeenCalledTimes(2);
  });

  it("shares suspensions across planner instances via an external health tracker", async () => {
    const unauthorized = new IxplorerError({
      code: "WEB_SEARCH_FAILED",
      message: "Brave rejected the credentials.",
      details: { sourceId: "brave", reason: "unauthorized" },
    });
    const health = new WebSourceHealthTracker();
    const brave = fakeSource("brave", unauthorized);
    const braveSearch = vi.spyOn(brave, "search");
    const registry = { enabledSources: () => [brave] };

    await new WebQueryPlanner({ registry, health }).search("q1");
    // Planners are recreated per research run; the tracker keeps the suspension.
    await new WebQueryPlanner({ registry, health }).search("q2");
    expect(braveSearch).toHaveBeenCalledTimes(1);
    expect(health.getIssue("brave")).toMatchObject({ reason: "unauthorized" });

    health.reset("brave");
    expect(health.getIssue("brave")).toBeUndefined();
  });

  it("delegates page fetches and degrades gracefully without a delegate", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ ok: true });
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [] },
      fetchDelegate: { search: () => Promise.resolve([]), fetchPage },
    });
    await planner.fetchPage("https://a.dev/");
    expect(fetchPage).toHaveBeenCalledWith("https://a.dev/", undefined);

    const bare = new WebQueryPlanner({ registry: { enabledSources: () => [] } });
    await expect(bare.fetchPage("https://a.dev/")).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-unavailable" },
    });
  });
});

describe("parseWebSearchInput", () => {
  it("accepts a valid category, rejects an invalid one, and keeps base validation", () => {
    expect(parseWebSearchInput({ query: "q", category: "academic" })).toMatchObject({
      ok: true,
      value: { query: "q", category: "academic" },
    });
    expect(parseWebSearchInput({ query: "q" })).toMatchObject({
      ok: true,
      value: { query: "q" },
    });
    expect(parseWebSearchInput({ query: "q", category: "nonsense" })).toMatchObject({
      ok: false,
      error: { code: "invalid-category" },
    });
    expect(parseWebSearchInput({ query: "q", bogus: 1 })).toMatchObject({
      ok: false,
      error: { code: "unknown-property" },
    });
  });
});

describe("FetchFallbackChain", () => {
  const okPage = (content: string) => ({
    ok: true as const,
    url: "https://a.dev/",
    finalUrl: "https://a.dev/",
    content,
    contentType: "text/html",
    bytes: content.length,
    truncated: false,
    redirects: [],
  });
  const failedPage = {
    ok: false as const,
    error: { code: "web-fetch-http", message: "HTTP 403", retryable: false },
  };

  it("returns the primary result without touching fallbacks when it succeeds", async () => {
    const fallbackFetch = vi.fn();
    const chain = new FetchFallbackChain({
      primary: { search: async () => [], fetchPage: async () => okPage("native") },
      fallbacks: [{ id: "jina", fetchPage: fallbackFetch }],
    });

    const page = await chain.fetchPage("https://a.dev/");
    expect(page).toMatchObject({ ok: true, content: "native" });
    expect(fallbackFetch).not.toHaveBeenCalled();
  });

  it("walks the chain in order and returns the first success", async () => {
    const order: string[] = [];
    const chain = new FetchFallbackChain({
      primary: {
        search: async () => [],
        fetchPage: async () => {
          order.push("primary");
          return failedPage;
        },
      },
      fallbacks: [
        {
          id: "jina",
          fetchPage: async () => {
            order.push("jina");
            return failedPage;
          },
        },
        {
          id: "wayback",
          fetchPage: async () => {
            order.push("wayback");
            return okPage("archived");
          },
        },
      ],
      onFallback: (id) => order.push(`fallback:${id}`),
    });

    const page = await chain.fetchPage("https://a.dev/");
    expect(page).toMatchObject({ ok: true, content: "archived" });
    expect(order).toEqual(["primary", "fallback:primary", "jina", "fallback:jina", "wayback"]);
  });

  it("returns the last failure when every link fails", async () => {
    const chain = new FetchFallbackChain({
      primary: { search: async () => [], fetchPage: async () => failedPage },
      fallbacks: [
        {
          id: "wayback",
          fetchPage: async () => ({
            ok: false as const,
            error: { code: "web-fetch-no-snapshot", message: "none", retryable: false },
          }),
        },
      ],
    });

    await expect(chain.fetchPage("https://a.dev/")).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-no-snapshot" },
    });
  });
});
