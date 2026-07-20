// Recency / language / query-sanitizing behavior added after the "London news"
// incident: the model wrote dates into queries and got stale or empty results.

import {
  detectQueryLanguage,
  extractSiteFilters,
  findWebSourceDescriptor,
  inferQueryRecency,
  recencyFloor,
  stripTemporalNoise,
} from "@core/web";
import { parseWebSearchInput } from "@application/research";
import { SearchProviderResult, WebSearchSource } from "@application/ports";
import { WebQueryPlanner } from "@application/web";
import { HttpWebSearchSource } from "@adapters/web";
import { hackerNewsDefinition, newsApiDefinition } from "@adapters/web/sources/communitySources";
import { braveDefinition } from "@adapters/web/sources/serpSources";
import { wikipediaDefinition } from "@adapters/web/sources/academicSources";

describe("query context helpers", () => {
  it.each([
    ["главные новости лондона за последние 24 часа", "day"],
    ["London news today", "day"],
    ["releases this week", "week"],
    ["что вышло за месяц", "month"],
    ["history of the Roman empire", undefined],
  ] as const)("inferQueryRecency(%s) → %s", (query, recency) => {
    expect(inferQueryRecency(query)).toBe(recency);
  });

  it("detects Cyrillic queries as Russian", () => {
    expect(detectQueryLanguage("главные новости Лондона")).toBe("ru");
    expect(detectQueryLanguage("London news")).toBe("en");
  });

  it("computes the recency floor relative to now", () => {
    const now = new Date("2026-07-02T12:00:00Z");
    expect(recencyFloor("day", now).toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("extracts site: operators into domains", () => {
    expect(extractSiteFilters("London site:bbc.com news")).toEqual({
      query: "London news",
      domains: ["bbc.com"],
    });
  });

  it("strips date words but never empties the query", () => {
    expect(stripTemporalNoise("London news today July 2 2026")).toBe("London news");
    expect(stripTemporalNoise("новости Лондона 2 июля 2026")).toBe("новости Лондона");
    expect(stripTemporalNoise("today 2026")).toBe("today 2026");
  });
});

describe("freshness-aware request building", () => {
  const base = { limit: 5, credentials: { apiKey: "k" } };

  it("NewsAPI maps freshFrom/language/domains onto native parameters", () => {
    const request = newsApiDefinition.buildRequest({
      ...base,
      query: "London",
      recency: "day",
      freshFrom: "2026-07-01T12:00:00.000Z",
      language: "ru",
      domains: ["bbc.com"],
    });
    const url = new URL(request.url);
    expect(url.searchParams.get("from")).toBe("2026-07-01T12:00:00.000Z");
    expect(url.searchParams.get("sortBy")).toBe("publishedAt");
    expect(url.searchParams.get("language")).toBe("ru");
    expect(url.searchParams.get("domains")).toBe("bbc.com");
  });

  it("NewsAPI keeps relevance ordering for time-neutral queries", () => {
    const request = newsApiDefinition.buildRequest({ ...base, query: "London" });
    expect(new URL(request.url).searchParams.get("sortBy")).toBe("relevancy");
  });

  it("Hacker News switches to search_by_date with a created_at floor", () => {
    const request = hackerNewsDefinition.buildRequest({
      ...base,
      query: "London",
      recency: "day",
      freshFrom: "2026-07-01T12:00:00.000Z",
    });
    expect(request.url).toContain("/search_by_date?");
    expect(decodeURIComponent(request.url)).toContain(
      `created_at_i>${Math.floor(Date.parse("2026-07-01T12:00:00.000Z") / 1_000)}`,
    );
    const relevance = hackerNewsDefinition.buildRequest({ ...base, query: "London" });
    expect(relevance.url).toContain("/search?");
  });

  it("Brave maps recency to freshness codes", () => {
    const request = braveDefinition.buildRequest({ ...base, query: "London", recency: "week" });
    expect(request.url).toContain("freshness=pw");
  });

  it("Wikipedia switches to the Russian edition for Russian queries", () => {
    const request = wikipediaDefinition.buildRequest({ ...base, query: "Лондон", language: "ru" });
    expect(request.url).toContain("https://ru.wikipedia.org/");
    const [result] = wikipediaDefinition.parseResponse(
      JSON.stringify({ query: { search: [{ title: "Лондон", snippet: "город" }] } }),
      { ...base, query: "Лондон", language: "ru" },
    );
    expect(result.url).toContain("ru.wikipedia.org/wiki/");
  });
});

describe("engine query sanitizing", () => {
  const jsonResponse = (body: string) =>
    new Response(body, { status: 200, headers: { "content-type": "application/json" } });

  it("strips site: operators and date noise for keyword APIs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ articles: [] })));
    const source = new HttpWebSearchSource(newsApiDefinition, {
      credentials: { apiKey: "k" },
      fetch: fetchMock as typeof fetch,
    });

    await source.search("London news today July 2 2026 site:bbc.com", { recency: "day" });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("q")).toBe("London news");
    expect(url.searchParams.get("domains")).toBe("bbc.com");
    expect(url.searchParams.get("from")).toBeTruthy();
  });

  it("keeps site: operators for SERP engines that understand them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(JSON.stringify({ web: { results: [] } })));
    const source = new HttpWebSearchSource(braveDefinition, {
      credentials: { apiKey: "k" },
      fetch: fetchMock as typeof fetch,
    });

    await source.search("London site:bbc.com");
    expect(decodeURIComponent(String(fetchMock.mock.calls[0]?.[0]))).toContain("site:bbc.com");
  });
});

describe("planner language routing and recency inference", () => {
  function fakeSource(id: string, results: SearchProviderResult[]): WebSearchSource {
    const descriptor = findWebSourceDescriptor(id);
    if (!descriptor) throw new Error(`missing descriptor: ${id}`);
    return { descriptor, search: vi.fn().mockResolvedValue(results) };
  }

  it("skips English-only sources for Cyrillic queries", async () => {
    const hackernews = fakeSource("hackernews", []);
    const newsapi = fakeSource("newsapi", []);
    const planner = new WebQueryPlanner({
      registry: { enabledSources: () => [hackernews, newsapi] },
    });

    await planner.search("главные новости лондона за последние 24 часа");
    expect(hackernews.search).not.toHaveBeenCalled();
    expect(newsapi.search).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ language: "ru", recency: "day" }),
    );
  });

  it("passes an explicit recency through to sources", async () => {
    const newsapi = fakeSource("newsapi", []);
    const planner = new WebQueryPlanner({ registry: { enabledSources: () => [newsapi] } });

    await planner.search("London mayor election", { intent: "news", recency: "week" });
    expect(newsapi.search).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ recency: "week" }),
    );
  });
});

describe("parseWebSearchInput limits and recency", () => {
  it("accepts limits up to 15 and clamps beyond", () => {
    expect(parseWebSearchInput({ query: "q", limit: 12 })).toMatchObject({
      ok: true,
      value: { limit: 12 },
    });
    expect(parseWebSearchInput({ query: "q", limit: 40 })).toMatchObject({
      ok: true,
      value: { limit: 15 },
    });
  });

  it("validates the recency value", () => {
    expect(parseWebSearchInput({ query: "q", recency: "day" })).toMatchObject({
      ok: true,
      value: { recency: "day" },
    });
    expect(parseWebSearchInput({ query: "q", recency: "hour" })).toMatchObject({
      ok: false,
      error: { code: "invalid-recency" },
    });
  });
});
