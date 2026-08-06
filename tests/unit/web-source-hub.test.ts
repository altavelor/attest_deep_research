import { WEB_SOURCE_CATALOG, WebSourceProfile } from "@core/web";
import { IxplorerError } from "@core/errors";
import { createWebSearchSources, HttpWebSearchSource, WEB_SOURCE_DEFINITIONS } from "@adapters/web";
import {
  DEFAULT_SETTINGS,
  getWebSourceProfile,
  isWebSourceConfigured,
  readSettings,
  upsertWebSourceProfile,
} from "@adapters/settings";

const CREDENTIALS: Record<string, string> = {
  apiKey: "test-key",
  engineId: "test-cx",
  baseUrl: "https://searx.example.org",
};

interface DefinitionFixture {
  urlIncludes: string[];

  body: string;
  expected: { title: string; url: string; snippet?: string; hasText?: boolean };
}

const FIXTURES: Record<string, DefinitionFixture> = {
  brave: {
    urlIncludes: ["api.search.brave.com", "q=obsidian%20plugins"],
    body: JSON.stringify({
      web: { results: [{ title: "Brave hit", url: "https://a.dev/", description: "desc" }] },
    }),
    expected: { title: "Brave hit", url: "https://a.dev/", snippet: "desc" },
  },
  "google-cse": {
    urlIncludes: ["customsearch/v1", "key=test-key", "cx=test-cx"],
    body: JSON.stringify({
      items: [{ title: "CSE hit", link: "https://b.dev/", snippet: "desc" }],
    }),
    expected: { title: "CSE hit", url: "https://b.dev/", snippet: "desc" },
  },
  serper: {
    urlIncludes: ["google.serper.dev/search"],
    body: JSON.stringify({
      organic: [{ title: "Serper hit", link: "https://c.dev/", snippet: "desc" }],
    }),
    expected: { title: "Serper hit", url: "https://c.dev/", snippet: "desc" },
  },
  searxng: {
    urlIncludes: ["https://searx.example.org/search", "format=json"],
    body: JSON.stringify({
      results: [{ title: "SearXNG hit", url: "https://d.dev/", content: "desc" }],
    }),
    expected: { title: "SearXNG hit", url: "https://d.dev/", snippet: "desc" },
  },
  tavily: {
    urlIncludes: ["api.tavily.com/search"],
    body: JSON.stringify({
      results: [{ title: "Tavily hit", url: "https://e.dev/", content: "full text" }],
    }),
    expected: { title: "Tavily hit", url: "https://e.dev/", hasText: true },
  },
  exa: {
    urlIncludes: ["api.exa.ai/search"],
    body: JSON.stringify({
      results: [{ title: "Exa hit", url: "https://f.dev/", text: "full text" }],
    }),
    expected: { title: "Exa hit", url: "https://f.dev/", hasText: true },
  },
  jina: {
    urlIncludes: ["s.jina.ai", "q=obsidian%20plugins"],
    body: JSON.stringify({
      data: [{ title: "Jina hit", url: "https://g.dev/", description: "desc" }],
    }),
    expected: { title: "Jina hit", url: "https://g.dev/", snippet: "desc" },
  },
  firecrawl: {
    urlIncludes: ["api.firecrawl.dev/v1/search"],
    body: JSON.stringify({
      data: [
        { title: "Firecrawl hit", url: "https://h.dev/", description: "desc", markdown: "# md" },
      ],
    }),
    expected: { title: "Firecrawl hit", url: "https://h.dev/", hasText: true },
  },
  arxiv: {
    urlIncludes: ["export.arxiv.org/api/query", "all%3Aobsidian%20plugins"],
    body: `<feed><entry><id>https://arxiv.org/abs/1234.5678</id><title>Paper
      title</title><summary>Abstract &amp; more.</summary></entry></feed>`,
    expected: {
      title: "Paper title",
      url: "https://arxiv.org/abs/1234.5678",
      snippet: "Abstract & more.",
    },
  },
  "semantic-scholar": {
    urlIncludes: ["api.semanticscholar.org/graph/v1/paper/search"],
    body: JSON.stringify({
      data: [{ title: "S2 paper", url: "https://s2.dev/p", abstract: "abs", year: 2024 }],
    }),
    expected: { title: "S2 paper (2024)", url: "https://s2.dev/p", snippet: "abs" },
  },
  openalex: {
    urlIncludes: ["api.openalex.org/works", "search=obsidian"],
    body: JSON.stringify({
      results: [
        {
          display_name: "OA work",
          publication_year: 2023,
          primary_location: {
            landing_page_url: "https://j.dev/w",
            source: { display_name: "Journal" },
          },
        },
      ],
    }),
    expected: { title: "OA work (2023)", url: "https://j.dev/w", snippet: "Journal" },
  },
  "europe-pmc": {
    urlIncludes: ["ebi.ac.uk/europepmc", "format=json"],
    body: JSON.stringify({
      resultList: {
        result: [
          {
            title: "PMC paper",
            source: "MED",
            id: "42",
            authorString: "Doe J.",
            journalTitle: "Cell",
            pubYear: "2022",
          },
        ],
      },
    }),
    expected: {
      title: "PMC paper",
      url: "https://europepmc.org/article/MED/42",
      snippet: "Doe J. · Cell · 2022",
    },
  },
  wikipedia: {
    urlIncludes: ["en.wikipedia.org/w/api.php", "list=search"],
    body: JSON.stringify({
      query: {
        search: [{ title: "Obsidian (software)", snippet: 'note <span class="x">app</span>' }],
      },
    }),
    expected: {
      title: "Obsidian (software)",
      url: "https://en.wikipedia.org/wiki/Obsidian_(software)",
      snippet: "note app",
    },
  },
  github: {
    urlIncludes: ["api.github.com/search/repositories"],
    body: JSON.stringify({
      items: [
        {
          full_name: "org/repo",
          html_url: "https://github.com/org/repo",
          description: "desc",
          stargazers_count: 12,
        },
      ],
    }),
    expected: { title: "org/repo ★12", url: "https://github.com/org/repo", snippet: "desc" },
  },
  stackexchange: {
    urlIncludes: ["api.stackexchange.com/2.3/search/advanced", "site=stackoverflow"],
    body: JSON.stringify({
      items: [
        {
          title: "How to &quot;plugin&quot;?",
          link: "https://stackoverflow.com/q/1",
          answer_count: 3,
          is_answered: true,
          score: 7,
        },
      ],
    }),
    expected: {
      title: 'How to "plugin"?',
      url: "https://stackoverflow.com/q/1",
      snippet: "3 answers · accepted answer · score 7",
    },
  },
  hackernews: {
    urlIncludes: ["hn.algolia.com/api/v1/search", "tags=story"],
    body: JSON.stringify({
      hits: [
        { title: "HN story", url: "https://k.dev/", objectID: "99", points: 5, num_comments: 2 },
      ],
    }),
    expected: {
      title: "HN story",
      url: "https://k.dev/",
      snippet: "5 points · 2 comments · https://news.ycombinator.com/item?id=99",
    },
  },
  newsapi: {
    urlIncludes: ["newsapi.org/v2/everything"],
    body: JSON.stringify({
      articles: [
        {
          title: "News hit",
          url: "https://l.dev/n",
          description: "desc",
          source: { name: "Wire" },
          publishedAt: "2026-07-01T10:00:00Z",
        },
      ],
    }),
    expected: { title: "News hit", url: "https://l.dev/n", snippet: "desc · Wire · 2026-07-01" },
  },
};

function jsonResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function sourceFor(id: string, fetchMock: typeof fetch): HttpWebSearchSource {
  const definition = WEB_SOURCE_DEFINITIONS.find((entry) => entry.descriptor.id === id);
  if (!definition) throw new Error(`No definition: ${id}`);
  return new HttpWebSearchSource(definition, {
    credentials: CREDENTIALS,
    fetch: fetchMock,
    now: () => new Date("2026-07-02T00:00:00Z"),
  });
}

describe("web source definitions", () => {
  it("covers every search-capable catalog entry with a definition and vice versa", () => {
    const searchCatalogIds = WEB_SOURCE_CATALOG.filter(
      (descriptor) => descriptor.id !== "duckduckgo" && descriptor.capabilities?.search !== false,
    )
      .map((descriptor) => descriptor.id)
      .sort();
    const definitionIds = WEB_SOURCE_DEFINITIONS.map((entry) => entry.descriptor.id).sort();
    expect(definitionIds).toEqual(searchCatalogIds);
    expect(Object.keys(FIXTURES).sort()).toEqual(searchCatalogIds);
  });

  for (const [id, fixture] of Object.entries(FIXTURES)) {
    it(`${id}: builds the request and parses the response`, async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture.body));
      const results = await sourceFor(id, fetchMock as typeof fetch).search("obsidian plugins");

      const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
      for (const fragment of fixture.urlIncludes) {
        expect(requestedUrl).toContain(fragment);
      }

      expect(results).toHaveLength(1);
      const [result] = results;
      expect(result.rank).toBe(1);
      expect(result.query).toBe("obsidian plugins");
      expect(result.source.kind).toBe("web");
      expect(result.source.title).toBe(fixture.expected.title);
      expect(result.source.url).toBe(fixture.expected.url);
      if (fixture.expected.snippet !== undefined) {
        expect(result.source.snippet).toBe(fixture.expected.snippet);
      }
      if (fixture.expected.hasText) {
        expect(result.extractedText).toBeTruthy();
        expect(result.source.wasContentFetched).toBe(true);
      }
    });
  }
});

describe("HttpWebSearchSource", () => {
  it("refuses to search when required credentials are missing", async () => {
    const fetchMock = vi.fn();
    const definition = WEB_SOURCE_DEFINITIONS.find((entry) => entry.descriptor.id === "brave")!;
    const source = new HttpWebSearchSource(definition, { fetch: fetchMock as typeof fetch });

    await expect(source.search("query")).rejects.toMatchObject({
      code: "WEB_SEARCH_FAILED",
      details: { sourceId: "brave", reason: "not-configured" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches without credentials when all fields are optional", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({ hits: [] })));
    const definition = WEB_SOURCE_DEFINITIONS.find(
      (entry) => entry.descriptor.id === "hackernews",
    )!;
    const source = new HttpWebSearchSource(definition, { fetch: fetchMock as typeof fetch });

    await expect(source.search("query")).resolves.toEqual([]);
  });

  it("maps 401 and 429 to machine-readable failure reasons", async () => {
    for (const [status, reason] of [
      [401, "unauthorized"],
      [429, "rate-limited"],
    ] as const) {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse("{}", { status }));
      await expect(
        sourceFor("brave", fetchMock as typeof fetch).search("query"),
      ).rejects.toMatchObject({
        code: "WEB_SEARCH_FAILED",
        details: { reason, status },
      });
    }
  });

  it("wraps malformed payloads as bad-response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("not json"));
    await expect(
      sourceFor("brave", fetchMock as typeof fetch).search("query"),
    ).rejects.toMatchObject({ details: { reason: "bad-response" } });
  });

  it("drops results without a usable title or absolute URL and applies the limit", async () => {
    const body = JSON.stringify({
      hits: [
        { title: "Keep", url: "https://ok.dev/", objectID: "1" },
        { title: "  ", url: "https://blank-title.dev/", objectID: "2" },
        { title: "Relative", url: "/relative", objectID: "3" },
        { title: "Second keep", url: "https://ok2.dev/", objectID: "4" },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    const definition = WEB_SOURCE_DEFINITIONS.find(
      (entry) => entry.descriptor.id === "hackernews",
    )!;
    const source = new HttpWebSearchSource(definition, { fetch: fetchMock as typeof fetch });

    const results = await source.search("query", { limit: 1 });
    expect(results.map((entry) => entry.source.url)).toEqual(["https://ok.dev/"]);
  });

  it("returns [] for an empty query without touching the network", async () => {
    const fetchMock = vi.fn();
    await expect(sourceFor("brave", fetchMock as typeof fetch).search("  ")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces IxplorerError instances", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    const error = await sourceFor("brave", fetchMock as typeof fetch)
      .search("query")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IxplorerError);
  });
});

describe("createWebSearchSources", () => {
  const profile = (overrides: Partial<WebSourceProfile>): WebSourceProfile => ({
    sourceId: "brave",
    activation: "auto",
    credentials: { apiKey: "k" },
    ...overrides,
  });

  it("passes the planner-requested limit through to the source request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(JSON.stringify({ web: { results: [] } })));
    const [source] = createWebSearchSources([profile({})], { fetch: fetchMock as typeof fetch });

    await source.search("query", { limit: 12 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("count=12");
  });

  it("builds sources only for active, fully configured profiles", () => {
    const sources = createWebSearchSources([
      profile({}),
      profile({ sourceId: "tavily", activation: "off" }),
      profile({ sourceId: "serper", credentials: {} }),
      profile({ sourceId: "wikipedia", credentials: {} }),
      profile({ sourceId: "unknown-source" }),
    ]);

    expect(sources.map((source) => source.descriptor.id).sort()).toEqual(["brave", "wikipedia"]);
  });

  it("carries each profile's activation onto the built source", () => {
    const sources = createWebSearchSources([
      profile({}),
      profile({ sourceId: "wikipedia", activation: "always", credentials: {} }),
    ]);

    expect(sources.map((source) => [source.descriptor.id, source.activation])).toEqual([
      ["brave", "auto"],
      ["wikipedia", "always"],
    ]);
  });
});

describe("web source settings queries", () => {
  it("returns a switched-off blank profile for untouched sources and upserts in place", () => {
    const settings = { webSources: [] as WebSourceProfile[] };

    expect(getWebSourceProfile(settings, "brave")).toEqual({
      sourceId: "brave",
      activation: "off",
      credentials: {},
    });

    upsertWebSourceProfile(settings, {
      sourceId: "brave",
      activation: "off",
      credentials: { apiKey: "k" },
    });
    upsertWebSourceProfile(settings, {
      sourceId: "brave",
      activation: "always",
      credentials: { apiKey: "k2" },
    });

    expect(settings.webSources).toEqual([
      { sourceId: "brave", activation: "always", credentials: { apiKey: "k2" } },
    ]);
  });

  it("reports configured state from required credential completeness", () => {
    const settings = {
      webSources: [{ sourceId: "brave", activation: "off" as const, credentials: { apiKey: "k" } }],
    };
    expect(isWebSourceConfigured(settings, "brave")).toBe(true);
    expect(isWebSourceConfigured(settings, "tavily")).toBe(false);

    expect(isWebSourceConfigured(settings, "wikipedia")).toBe(true);
    expect(isWebSourceConfigured(settings, "nope")).toBe(false);
  });
});

describe("settings normalization for web sources", () => {
  it("backfills webSources for settings saved before the hub existed", () => {
    const legacy = { ...DEFAULT_SETTINGS, webSources: undefined } as unknown as Record<
      string,
      unknown
    >;
    const settings = readSettings(legacy);
    expect(settings.webSources).toEqual([]);
  });

  it("migrates legacy duckDuckGoEnabled/duckDuckGoResultLimit into a hub profile", () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      duckDuckGoEnabled: true,
      duckDuckGoResultLimit: 7,
    } as unknown as Record<string, unknown>;
    delete legacy.webSources;

    const settings = readSettings(legacy);
    expect(settings.webSources).toEqual([
      { sourceId: "duckduckgo", activation: "auto", credentials: {} },
    ]);
    expect("duckDuckGoEnabled" in settings).toBe(false);
    expect("duckDuckGoResultLimit" in settings).toBe(false);
  });

  it("drops unknown sources and force-disables incomplete ones", () => {
    const settings = readSettings({
      ...DEFAULT_SETTINGS,
      webSources: [
        { sourceId: "gone-from-catalog", activation: "auto", credentials: {} },
        { sourceId: "brave", activation: "auto", credentials: {} },
        { sourceId: "brave", activation: "always", credentials: { apiKey: "k", junk: 5 } },
        { sourceId: "arxiv", activation: "auto", credentials: {} },
      ],
    });

    expect(settings.webSources).toEqual([
      { sourceId: "brave", activation: "off", credentials: {} },
      { sourceId: "brave", activation: "always", credentials: { apiKey: "k" } },
      { sourceId: "arxiv", activation: "auto", credentials: {} },
    ]);
  });

  it("migrates the legacy enabled flag into an activation", () => {
    const settings = readSettings({
      ...DEFAULT_SETTINGS,
      webSources: [
        {
          sourceId: "brave",
          enabled: true,
          credentials: { apiKey: "k" },
          imageSearchEnabled: true,
        },
        { sourceId: "tavily", enabled: false, credentials: { apiKey: "t" } },
        { sourceId: "arxiv", credentials: {} },
      ],
    });

    expect(settings.webSources).toEqual([
      {
        sourceId: "brave",
        activation: "auto",
        credentials: { apiKey: "k" },
        imageSearchEnabled: true,
      },
      { sourceId: "tavily", activation: "off", credentials: { apiKey: "t" } },
      { sourceId: "arxiv", activation: "off", credentials: {} },
    ]);
    expect(settings.webSources.some((profile) => "enabled" in profile)).toBe(false);
  });

  it("survives malformed webSources entries instead of failing the whole load", () => {
    const settings = readSettings({
      ...DEFAULT_SETTINGS,
      webSources: [
        null,
        "brave",
        {},
        { sourceId: "brave", enabled: true, credentials: { apiKey: "k" } },
      ],
    });

    expect(settings.webSources).toEqual([
      { sourceId: "brave", activation: "auto", credentials: { apiKey: "k" } },
    ]);
  });

  it("keeps a stored activation and switches off sources with incomplete credentials", () => {
    const settings = readSettings({
      ...DEFAULT_SETTINGS,
      webSources: [
        { sourceId: "brave", activation: "always", enabled: false, credentials: { apiKey: "k" } },
        { sourceId: "tavily", activation: "always", credentials: {} },
        { sourceId: "serper", activation: "nonsense", credentials: { apiKey: "s" } },
      ],
    });

    expect(settings.webSources).toEqual([
      { sourceId: "brave", activation: "always", credentials: { apiKey: "k" } },
      { sourceId: "tavily", activation: "off", credentials: {} },
      { sourceId: "serper", activation: "off", credentials: { apiKey: "s" } },
    ]);
  });
});
