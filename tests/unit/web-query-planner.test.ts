import {
  classifyWebQuery,
  DUCKDUCKGO_DESCRIPTOR,
  mergeRankedResults,
  selectWebSources,
  WEB_SOURCE_CATALOG,
  WebSourceActivation,
  findWebSourceDescriptor,
} from "@core/web";
import type { WebSourceSelectionDiagnostics } from "@core/diagnostics";
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

function fakeSource(
  id: string,
  results: SearchProviderResult[] | Error,
  activation: WebSourceActivation = "auto",
): WebSearchSource {
  const descriptor = findWebSourceDescriptor(id) ?? DUCKDUCKGO_DESCRIPTOR;
  return {
    descriptor: { ...descriptor, id },
    activation,
    search: () => (results instanceof Error ? Promise.reject(results) : Promise.resolve(results)),
  };
}

function slowSource(
  id: string,
  results: SearchProviderResult[],
  delayMs: number,
  activation: WebSourceActivation = "auto",
  onAbort?: () => never,
): WebSearchSource {
  const descriptor = findWebSourceDescriptor(id) ?? DUCKDUCKGO_DESCRIPTOR;
  return {
    descriptor: { ...descriptor, id },
    activation,
    search: (_query, options) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(results), delayMs);
        options?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          try {
            onAbort?.();
            reject(new Error("aborted"));
          } catch (error) {
            reject(error);
          }
        });
      }),
  };
}

function catalogCandidates(activation: WebSourceActivation = "auto") {
  return WEB_SOURCE_CATALOG.map((descriptor) => ({ descriptor, activation }));
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

describe("selectWebSources", () => {
  it("queries only serp and neural sources in instant mode", () => {
    const selection = selectWebSources(catalogCandidates(), { mode: "instant" });

    expect(selection.ordered.every((c) => ["serp", "neural"].includes(c.descriptor.category))).toBe(
      true,
    );
    expect(selection.ordered.some((c) => c.descriptor.id === "arxiv")).toBe(false);
    expect(selection.excluded.find((e) => e.sourceId === "arxiv")?.reason).toBe(
      "instant-specialized",
    );
  });

  it("keeps an `always` source in instant mode regardless of its category", () => {
    const candidates = WEB_SOURCE_CATALOG.map((descriptor) => ({
      descriptor,
      activation: descriptor.id === "arxiv" ? ("always" as const) : ("auto" as const),
    }));
    const selection = selectWebSources(candidates, { mode: "instant" });

    expect(selection.ordered[0].descriptor.id).toBe("arxiv");
    expect(selection.excluded.some((e) => e.sourceId === "arxiv")).toBe(false);
  });

  it("drops the sources that carry no signal for the intent in thinking mode", () => {
    const all = catalogCandidates();
    const academic = selectWebSources(all, { mode: "thinking", intent: "academic" });

    const planned = academic.ordered.map((c) => c.descriptor.id);
    expect(planned).toContain("arxiv");
    expect(planned).toContain("duckduckgo");
    expect(planned).not.toContain("wikipedia");
    expect(planned).not.toContain("stackexchange");
    expect(planned).not.toContain("newsapi");
    expect(academic.ordered[0].descriptor.category).toBe("academic");
    expect(academic.excluded.find((e) => e.sourceId === "newsapi")?.reason).toBe("intent-mismatch");
  });

  it("keeps the encyclopedic pool down to the encyclopedia and the generalists", () => {
    const selection = selectWebSources(catalogCandidates(), {
      mode: "thinking",
      intent: "encyclopedic",
    });

    expect(selection.ordered[0].descriptor.id).toBe("wikipedia");
    expect(selection.ordered.map((c) => c.descriptor.id)).toEqual(
      expect.not.arrayContaining(["arxiv", "semantic-scholar", "github", "newsapi"]),
    );
    expect(selection.ordered.every((c) => c.descriptor.category !== "academic")).toBe(true);
  });

  it("orders sources by how much of the intent their tags cover", () => {
    const selection = selectWebSources(catalogCandidates(), { mode: "thinking", intent: "code" });

    const position = (id: string) => selection.ordered.findIndex((c) => c.descriptor.id === id);
    expect(position("stackexchange")).toBeGreaterThanOrEqual(0);
    expect(position("stackexchange")).toBeLessThan(position("github"));
    expect(position("github")).toBeLessThan(position("hackernews"));
  });

  it("does not add up a tag match and a category match for the same source", () => {
    const github = WEB_SOURCE_CATALOG.find((d) => d.id === "github")!;
    const selection = selectWebSources(
      [
        {
          descriptor: { ...github, id: "narrow-community", strengths: ["code", "qa"] },
          activation: "auto",
        },
        {
          descriptor: {
            ...github,
            id: "broad-outsider",
            category: "serp",
            strengths: ["code", "qa", "troubleshooting", "repositories"],
          },
          activation: "auto",
        },
      ],
      { mode: "thinking", intent: "code" },
    );

    expect(selection.ordered.map((c) => c.descriptor.id)).toEqual([
      "broad-outsider",
      "narrow-community",
    ]);
  });

  it("treats a generalist the same way under general and under a specialized intent", () => {
    const candidates = catalogCandidates();
    const general = selectWebSources(candidates, { mode: "thinking", intent: "general" });
    const academic = selectWebSources(candidates, { mode: "thinking", intent: "academic" });

    for (const id of ["duckduckgo", "exa", "tavily"]) {
      expect(general.ordered.some((c) => c.descriptor.id === id)).toBe(true);
      expect(academic.ordered.some((c) => c.descriptor.id === id)).toBe(true);
    }
    const rank = (selection: typeof general, id: string) =>
      selection.ordered.findIndex((c) => c.descriptor.id === id);
    expect(rank(general, "exa")).toBeLessThan(rank(general, "jina"));
    expect(rank(academic, "exa")).toBeLessThan(rank(academic, "jina"));
  });

  it("keeps wikipedia on a general query while dropping the specialists", () => {
    const planned = selectWebSources(catalogCandidates(), {
      mode: "thinking",
      intent: "general",
    }).ordered.map((c) => c.descriptor.id);

    expect(planned).toContain("wikipedia");
    expect(planned).toContain("duckduckgo");
    expect(planned).not.toContain("newsapi");
    expect(planned).not.toContain("arxiv");
  });

  it("plans every enabled source when no source qualifies for the intent", () => {
    const academicOnly = WEB_SOURCE_CATALOG.filter((d) => d.category === "academic").map(
      (descriptor) => ({ descriptor, activation: "auto" as const }),
    );
    const selection = selectWebSources(academicOnly, { mode: "thinking", intent: "news" });

    expect(selection.ordered).toHaveLength(academicOnly.length);
    expect(selection.excluded).toHaveLength(0);
  });

  it("does not filter by intent when the intent is unknown", () => {
    const all = catalogCandidates();
    const selection = selectWebSources(all, { mode: "thinking", language: "ru" });

    const searchable = all.filter((c) => c.descriptor.capabilities?.search !== false);
    expect(selection.ordered).toHaveLength(searchable.length);
    expect(selection.excluded.every((e) => e.reason !== "intent-mismatch")).toBe(true);
  });

  it("keeps an `always` source that carries no signal for the intent", () => {
    const candidates = WEB_SOURCE_CATALOG.map((descriptor) => ({
      descriptor,
      activation: descriptor.id === "arxiv" ? ("always" as const) : ("auto" as const),
    }));
    const selection = selectWebSources(candidates, { mode: "thinking", intent: "encyclopedic" });

    expect(selection.ordered[0].descriptor.id).toBe("arxiv");
    expect(selection.excluded.some((e) => e.sourceId === "arxiv")).toBe(false);
  });

  it("ranks an english-only source lower for a russian query but keeps it", () => {
    const candidates = catalogCandidates();
    const ru = selectWebSources(candidates, { mode: "thinking", intent: "code", language: "ru" });
    const en = selectWebSources(candidates, { mode: "thinking", intent: "code", language: "en" });

    const position = (selection: typeof ru, id: string) =>
      selection.ordered.findIndex((c) => c.descriptor.id === id);
    expect(position(ru, "github")).toBeGreaterThan(position(en, "github"));
    expect(position(ru, "github")).toBeGreaterThanOrEqual(0);
  });

  it("excludes only switched-off sources", () => {
    const selection = selectWebSources(catalogCandidates("off"), { mode: "thinking" });
    expect(selection.ordered).toHaveLength(0);
    expect(selection.excluded.every((e) => e.reason === "disabled")).toBe(true);
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
  it("queries every enabled source in thinking mode and merges with new ranks", async () => {
    const arxiv = fakeSource("arxiv", [result("https://arxiv.org/1", 1)]);
    const scholar = fakeSource("semantic-scholar", [
      result("https://s2.dev/1", 1),
      result("https://arxiv.org/1", 2),
    ]);
    const brave = fakeSource("brave", [result("https://brave.dev/", 1)]);
    const braveSearch = vi.spyOn(brave, "search");

    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave, arxiv, scholar] },
    });
    const results = await planner.search("arxiv paper on RAG", { intent: "academic" });

    expect(braveSearch).toHaveBeenCalled();
    expect(results.map((item) => item.source.url).slice(0, 2)).toEqual([
      "https://arxiv.org/1",
      "https://s2.dev/1",
    ]);
    expect(results.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it("skips specialized sources in instant mode but keeps `always` ones", async () => {
    const arxiv = fakeSource("arxiv", [result("https://arxiv.org/1", 1)]);
    const wikipedia = fakeSource("wikipedia", [result("https://wiki.dev/1", 1)], "always");
    const brave = fakeSource("brave", [result("https://brave.dev/", 1)]);
    const arxivSearch = vi.spyOn(arxiv, "search");
    const wikiSearch = vi.spyOn(wikipedia, "search");
    const braveSearch = vi.spyOn(brave, "search");

    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave, arxiv, wikipedia] },
    });
    await planner.search("arxiv paper on retrieval augmentation", { mode: "instant" });

    expect(arxivSearch).not.toHaveBeenCalled();
    expect(wikiSearch).toHaveBeenCalled();
    expect(braveSearch).toHaveBeenCalled();
  });

  it("does not classify the query in instant mode", async () => {
    const classify = vi.fn();
    const planner = new WebQueryPlanner({
      registry: {
        enabledSources: () => [fakeSource("brave", [result("https://brave.dev/", 1)])],
      },
      intentClassifier: { classify },
    });

    await planner.search("arxiv paper on RAG", { mode: "instant" });
    expect(classify).not.toHaveBeenCalled();
  });

  it("uses the model classifier in thinking mode and degrades to the heuristic on failure", async () => {
    const arxiv = fakeSource("arxiv", [result("https://arxiv.org/1", 1)]);
    const brave = fakeSource("brave", [result("https://brave.dev/", 1)]);
    const traces: WebSourceSelectionDiagnostics[] = [];

    const modelPlanner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave, arxiv] },
      intentClassifier: {
        classify: async () => ({ intent: "academic" as const, origin: "model" as const }),
      },
    });
    await modelPlanner.search("consciousness emergence", {
      onSourceSelection: (d) => traces.push(d),
    });

    expect(traces[0]).toMatchObject({ intent: "academic", intentOrigin: "model" });
    expect(traces[0].sources[0].sourceId).toBe("arxiv");

    const failingPlanner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave, arxiv] },
      intentClassifier: {
        classify: async (query) => ({
          intent: classifyWebQuery(query),
          origin: "heuristic" as const,
          reason: "intent-classification-timeout",
        }),
      },
    });
    const fallbackTraces: WebSourceSelectionDiagnostics[] = [];
    await failingPlanner.search("arxiv paper on RAG", {
      onSourceSelection: (d) => fallbackTraces.push(d),
    });

    expect(fallbackTraces[0]).toMatchObject({
      intent: "academic",
      intentOrigin: "heuristic",
      intentReason: "intent-classification-timeout",
    });
  });

  it("returns what arrived before the deadline and marks the laggard", async () => {
    const fast = fakeSource("brave", [result("https://fast.dev/", 1)]);
    const slow = slowSource("duckduckgo", [result("https://slow.dev/", 1)], 10_000);
    const traces: WebSourceSelectionDiagnostics[] = [];

    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [fast, slow] },
    });
    const results = await planner.search("query", {
      deadlineMs: 25,
      onSourceSelection: (d) => traces.push(d),
    });

    expect(results.map((item) => item.source.url)).toEqual(["https://fast.dev/"]);
    expect(traces[0].deadlineExceeded).toBe(true);
    expect(traces[0].sources.find((s) => s.sourceId === "duckduckgo")?.outcome).toBe(
      "deadline-exceeded",
    );
  });

  it("aborts in-flight source searches when the caller cancels", async () => {
    const controller = new AbortController();
    let sawAbort = false;
    const inFlight: WebSearchSource = {
      descriptor: { ...DUCKDUCKGO_DESCRIPTOR },
      activation: "auto",
      search: (_query, options) =>
        new Promise((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("never")), 10_000);
          options?.signal?.addEventListener("abort", () => {
            sawAbort = true;
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
          setTimeout(() => controller.abort(), 5);
        }),
    };
    const traces: WebSourceSelectionDiagnostics[] = [];
    const planner = new WebQueryPlanner({ registry: { enabledSources: () => [inFlight] } });

    const results = await planner.search("query", {
      signal: controller.signal,
      deadlineMs: 10_000,
      onSourceSelection: (d) => traces.push(d),
    });

    expect(sawAbort).toBe(true);
    expect(results).toEqual([]);
    expect(traces[0].cancelled).toBe(true);
    expect(traces[0].deadlineExceeded).toBe(false);
  });

  it("reports an already-cancelled caller signal as cancelled, not as a missed deadline", async () => {
    const controller = new AbortController();
    const slow = slowSource("duckduckgo", [result("https://slow.dev/", 1)], 10_000);
    const traces: WebSourceSelectionDiagnostics[] = [];
    const planner = new WebQueryPlanner({ registry: { enabledSources: () => [slow] } });

    controller.abort();
    const results = await planner.search("query", {
      signal: controller.signal,
      deadlineMs: 10_000,
      onSourceSelection: (d) => traces.push(d),
    });

    expect(results).toEqual([]);
    expect(traces[0].cancelled).toBe(true);
    expect(traces[0].deadlineExceeded).toBe(false);
    expect(traces[0].sources[0].outcome).toBe("cancelled");
  });

  it("merges deterministically regardless of which source answers first", async () => {
    const shared = result("https://shared.dev/", 2);
    const build = (firstIsFast: boolean) => {
      const a = slowSource("brave", [result("https://a.dev/", 1), shared], firstIsFast ? 1 : 30);
      const b = slowSource(
        "duckduckgo",
        [result("https://b.dev/", 1), shared],
        firstIsFast ? 30 : 1,
      );
      return new WebQueryPlanner({ registry: { enabledSources: () => [a, b] } });
    };

    const first = await build(true).search("query", { deadlineMs: 5_000 });
    const second = await build(false).search("query", { deadlineMs: 5_000 });
    const urls = (items: typeof first) => items.map((item) => item.source.url);

    expect(urls(first)).toEqual(urls(second));
    expect(urls(first)).toEqual(["https://shared.dev/", "https://a.dev/", "https://b.dev/"]);
  });

  it("separates the per-source limit from the post-merge limit", async () => {
    const seen: Array<number | undefined> = [];
    const source: WebSearchSource = {
      descriptor: { ...DUCKDUCKGO_DESCRIPTOR },
      activation: "auto",
      search: (_query, options) => {
        seen.push(options?.limit);
        return Promise.resolve([
          result("https://1.dev/", 1),
          result("https://2.dev/", 2),
          result("https://3.dev/", 3),
        ]);
      },
    };
    const planner = new WebQueryPlanner({ registry: { enabledSources: () => [source] } });

    const results = await planner.search("query", { limit: 2, perSourceLimit: 10 });
    expect(seen).toEqual([10]);
    expect(results).toHaveLength(2);
  });

  it("caps how many sources are queried at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const make = (id: string): WebSearchSource => ({
      descriptor: { ...DUCKDUCKGO_DESCRIPTOR, id },
      activation: "auto",
      search: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return [result(`https://${id}.dev/`, 1)];
      },
    });
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => ["a", "b", "c", "d", "e", "f"].map(make) },
    });

    await planner.search("query", { maxConcurrentSources: 2, deadlineMs: 5_000 });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("reports the fate of every source in the selection trace", async () => {
    const unauthorized = new IxplorerError({
      code: "WEB_SEARCH_FAILED",
      message: "Brave rejected the credentials.",
      details: { sourceId: "brave", reason: "unauthorized" },
    });
    const brave = fakeSource("brave", unauthorized);
    const ddg = fakeSource("duckduckgo", [result("https://ok.dev/", 1)]);
    const off = fakeSource("serper", [result("https://off.dev/", 1)], "off");
    const planner = new WebQueryPlanner({ registry: { enabledSources: () => [brave, ddg, off] } });

    await planner.search("first");
    const traces: WebSourceSelectionDiagnostics[] = [];
    await planner.search("second", { onSourceSelection: (d) => traces.push(d) });

    expect(traces[0]).toMatchObject({ cancelled: false, deadlineExceeded: false });
    const byId = new Map(traces[0].sources.map((entry) => [entry.sourceId, entry]));
    expect(byId.get("brave")).toMatchObject({ outcome: "health-skipped", reason: "unauthorized" });
    expect(byId.get("serper")).toMatchObject({ outcome: "excluded" });
    expect(byId.get("duckduckgo")).toMatchObject({
      outcome: "queried",
      returnedResults: 1,
      promptResults: 1,
    });
  });

  it("traces the sources dropped for the intent and does not query them", async () => {
    const wikipedia = fakeSource("wikipedia", [result("https://wiki.dev/", 1)]);
    const arxiv = fakeSource("arxiv", [result("https://arxiv.org/1", 1)]);
    const arxivSearch = vi.spyOn(arxiv, "search");
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [wikipedia, arxiv] },
    });

    const traces: WebSourceSelectionDiagnostics[] = [];
    await planner.search("что такое нарзан", {
      intent: "encyclopedic",
      onSourceSelection: (d) => traces.push(d),
    });

    expect(arxivSearch).not.toHaveBeenCalled();
    const byId = new Map(traces[0].sources.map((entry) => [entry.sourceId, entry]));
    expect(byId.get("arxiv")).toMatchObject({
      outcome: "intent-filtered",
      reason: "no signal for intent: encyclopedic",
    });
    expect(byId.get("arxiv")).not.toHaveProperty("queryOrder");
    expect(byId.get("wikipedia")).toMatchObject({ outcome: "queried", queryOrder: 1 });
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
    const classify = vi.fn();
    const arxiv = fakeSource("arxiv", [result("https://arxiv.org/1", 1)]);
    const brave = fakeSource("brave", [result("https://brave.dev/1", 1)]);
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [brave, arxiv] },
      intentClassifier: { classify },
    });

    const results = await planner.search("consciousness emergence", { intent: "academic" });
    expect(classify).not.toHaveBeenCalled();
    expect(results[0].source.url).toBe("https://arxiv.org/1");
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

    await new WebQueryPlanner({ registry, health }).search("q2");
    expect(braveSearch).toHaveBeenCalledTimes(1);
    expect(health.getIssue("brave")).toMatchObject({ reason: "unauthorized" });

    health.reset("brave");
    expect(health.getIssue("brave")).toBeUndefined();
  });

  it("does not let a slow classifier outlive the web deadline", async () => {
    const source = fakeSource("duckduckgo", [result("https://ok.dev/", 1)]);
    const traces: WebSourceSelectionDiagnostics[] = [];
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [source] },
      intentClassifier: { classify: () => new Promise(() => {}) },
    });

    const startedAt = Date.now();
    const results = await planner.search("arxiv paper on RAG", {
      deadlineMs: 120,
      onSourceSelection: (d) => traces.push(d),
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(traces[0].intentOrigin).toBe("heuristic");
    expect(traces[0].intentReason).toBe("web-deadline");
    expect(traces[0].intent).toBe("academic");
    expect(results.map((item) => item.source.url)).toEqual(["https://ok.dev/"]);
  });

  it("queries nothing when classification has already spent the whole deadline", async () => {
    const instant = fakeSource("duckduckgo", [result("https://instant.dev/", 1)]);
    const search = vi.spyOn(instant, "search");
    const traces: WebSourceSelectionDiagnostics[] = [];
    const planner = new WebQueryPlanner({ registry: { enabledSources: () => [instant] } });

    const results = await planner.search("query", {
      deadlineMs: 0,
      onSourceSelection: (d) => traces.push(d),
    });

    expect(search).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    expect(traces[0].deadlineExceeded).toBe(true);
    expect(traces[0].sources[0].outcome).toBe("deadline-exceeded");
  });

  it("does not suspend a source that was only cut off by the deadline", async () => {
    const health = new WebSourceHealthTracker();
    const slow = slowSource("duckduckgo", [result("https://slow.dev/", 1)], 10_000, "auto", () => {
      // What HttpWebSearchSource actually throws when its request is aborted.
      throw new IxplorerError({
        code: "WEB_SEARCH_FAILED",
        message: "DuckDuckGo timed out.",
        details: { sourceId: "duckduckgo", reason: "timeout" },
      });
    });
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [slow] },
      health,
    });

    await planner.search("query", { deadlineMs: 20 });

    expect(health.getIssue("duckduckgo")).toBeUndefined();
  });

  it("does not suspend a source when the caller cancels the turn", async () => {
    const controller = new AbortController();
    const health = new WebSourceHealthTracker();
    const slow = slowSource("duckduckgo", [result("https://slow.dev/", 1)], 10_000);
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [slow] },
      health,
    });

    const pending = planner.search("query", { signal: controller.signal, deadlineMs: 10_000 });
    controller.abort();
    await pending;

    expect(health.getIssue("duckduckgo")).toBeUndefined();
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
