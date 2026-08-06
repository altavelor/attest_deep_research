import { describe, expect, it, vi } from "vitest";

import {
  braveImageDefinition,
  createImageSearchSources,
  HttpImageSearchSource,
  IMAGE_SOURCE_DEFINITIONS,
  OpenverseImageSource,
  parseCommonsPayload,
  parseOpenversePayload,
  WikimediaCommonsImageSource,
} from "@adapters/web";
import {
  findWebSourceDescriptor,
  WEB_SOURCE_CATALOG,
  OPENVERSE_SOURCE_ID,
  WIKIMEDIA_COMMONS_SOURCE_ID,
  type WebSourceProfile,
} from "@core/web";

const commonsBody = {
  query: {
    pages: [
      {
        title: "File:Cat.jpg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/1/13/Cat.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Cat.jpg",
            thumburl: "https://upload.wikimedia.org/thumb/Cat.jpg/480px-Cat.jpg",
            mime: "image/jpeg",
            width: 1200,
            height: 800,
            extmetadata: {
              Artist: { value: '<a href="/wiki/User:X">Jane Doe</a>' },
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
            },
          },
        ],
      },
      {
        title: "File:Diagram.svg",
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/2/2a/Diagram.svg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Diagram.svg",
            mime: "image/svg+xml",
            width: 100,
            height: 100,
          },
        ],
      },
      { title: "File:Broken.jpg", imageinfo: [] },
    ],
  },
};

const openverseBody = {
  results: [
    {
      id: "abc-123",
      title: "Mountain",
      url: "https://example.org/mountain.jpg",
      thumbnail: "https://example.org/mountain_thumb.jpg",
      foreign_landing_url: "https://example.org/photos/mountain",
      creator: "Sam Photo",
      license: "by",
      license_version: "4.0",
      license_url: "https://creativecommons.org/licenses/by/4.0/",
      attribution: "Mountain by Sam Photo, CC BY 4.0",
      width: 2000,
      height: 1300,
    },
    {
      id: "tracking",
      url: "https://example.org/pixel.gif",
      foreign_landing_url: "https://example.org/p",
      width: 1,
      height: 1,
    },
    { id: "no-landing", url: "https://example.org/x.png" },
  ],
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
}

function streamingResponse(chunks: string[]): Response {
  let index = 0;
  const encoder = new TextEncoder();
  const reader = {
    read: async () =>
      index < chunks.length
        ? { done: false, value: encoder.encode(chunks[index++]!) }
        : { done: true, value: undefined },
    cancel: async () => undefined,
  };
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    text: async () => chunks.join(""),
  } as unknown as Response;
}

describe("bounded image responses", () => {
  it("abandons an oversized provider response instead of buffering it", async () => {
    const oversized = ["x".repeat(600_000)];
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse(oversized));
    const source = new WikimediaCommonsImageSource(
      findWebSourceDescriptor(WIKIMEDIA_COMMONS_SOURCE_ID)!,
      { fetch: fetchMock as typeof fetch },
    );

    await expect(source.searchImages("cats")).rejects.toMatchObject({
      message: expect.stringContaining("oversized"),
    });
  });

  it("reads a response that stays inside the limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamingResponse([
          JSON.stringify(commonsBody).slice(0, 10),
          JSON.stringify(commonsBody).slice(10),
        ]),
      );
    const source = new WikimediaCommonsImageSource(
      findWebSourceDescriptor(WIKIMEDIA_COMMONS_SOURCE_ID)!,
      { fetch: fetchMock as typeof fetch },
    );

    await expect(source.searchImages("cats")).resolves.toHaveLength(1);
  });
});

describe("Wikimedia Commons image source", () => {
  it("normalizes bitmap results and drops ineligible entries", () => {
    const candidates = parseCommonsPayload(commonsBody);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      origin: "provider",
      format: "jpeg",
      fullUrl: commonsBody.query.pages[0]!.imageinfo[0]!.url,
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Cat.jpg",
      sourceLabel: "Wikimedia Commons · Jane Doe",
      licenceName: "CC BY-SA 4.0",
      licensed: true,
    });
    expect(candidates[0]!.sourceLabel).not.toContain("<a");
  });

  it("requests the File namespace and bounds the limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(commonsBody));
    const source = new WikimediaCommonsImageSource(
      findWebSourceDescriptor(WIKIMEDIA_COMMONS_SOURCE_ID)!,
      { fetch: fetchMock as typeof fetch },
    );
    const results = await source.searchImages("cats", { limit: 999 });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("gsrnamespace=6");
    expect(url).toContain("gsrlimit=20");
    expect(results).toHaveLength(1);
  });

  it("fails with a descriptive error on a malformed response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => "<html>" } as Response);
    const source = new WikimediaCommonsImageSource(
      findWebSourceDescriptor(WIKIMEDIA_COMMONS_SOURCE_ID)!,
      { fetch: fetchMock as typeof fetch },
    );
    await expect(source.searchImages("cats")).rejects.toThrow(/malformed/);
  });
});

describe("Openverse image source", () => {
  it("normalizes results, keeps attribution and drops tracking pixels", () => {
    const candidates = parseOpenversePayload(openverseBody);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      format: "jpeg",
      sourceUrl: "https://example.org/photos/mountain",
      sourceLabel: "Openverse · Sam Photo",
      licenceName: "BY 4.0",
      caption: "Mountain by Sam Photo, CC BY 4.0",
      licensed: true,
    });
  });

  it("sends the optional client token when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(openverseBody));
    const source = new OpenverseImageSource(
      findWebSourceDescriptor(OPENVERSE_SOURCE_ID)!,
      { apiKey: "secret" },
      { fetch: fetchMock as typeof fetch },
    );
    await source.searchImages("mountains");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });
});

describe("search-engine image endpoints", () => {
  const engineFixtures: Record<string, { body: unknown; expected: Record<string, unknown> }> = {
    brave: {
      body: {
        results: [
          {
            title: "Solar system",
            url: "https://astro.example.com/solar",
            source: "astro.example.com",
            thumbnail: { src: "https://cdn.brave.com/thumb.jpg" },
            properties: {
              url: "https://astro.example.com/img/solar.jpg",
              width: 1200,
              height: 800,
            },
          },
        ],
      },
      expected: {
        fullUrl: "https://astro.example.com/img/solar.jpg",
        sourceUrl: "https://astro.example.com/solar",
        sourceLabel: "astro.example.com · via Brave Search",
      },
    },
    "google-cse": {
      body: {
        items: [
          {
            title: "Solar system",
            link: "https://astro.example.com/img/solar.jpg",
            displayLink: "astro.example.com",
            image: {
              contextLink: "https://astro.example.com/solar",
              thumbnailLink: "https://cdn.google.com/thumb.jpg",
              width: 1200,
              height: 800,
            },
          },
        ],
      },
      expected: {
        fullUrl: "https://astro.example.com/img/solar.jpg",
        sourceUrl: "https://astro.example.com/solar",
        sourceLabel: "astro.example.com · via Google Programmable Search",
      },
    },
    serper: {
      body: {
        images: [
          {
            title: "Solar system",
            imageUrl: "https://astro.example.com/img/solar.jpg",
            thumbnailUrl: "https://cdn.serper.dev/thumb.jpg",
            link: "https://astro.example.com/solar",
            source: "astro.example.com",
            imageWidth: 1200,
            imageHeight: 800,
          },
        ],
      },
      expected: {
        fullUrl: "https://astro.example.com/img/solar.jpg",
        sourceUrl: "https://astro.example.com/solar",
        sourceLabel: "astro.example.com · via Serper.dev",
      },
    },
    searxng: {
      body: {
        results: [
          {
            title: "Solar system",
            img_src: "https://astro.example.com/img/solar.jpg",
            thumbnail_src: "https://searx.example.org/thumb.jpg",
            url: "https://astro.example.com/solar",
            engine: "bing images",
            img_width: 1200,
            img_height: 800,
          },
        ],
      },
      expected: {
        fullUrl: "https://astro.example.com/img/solar.jpg",
        sourceUrl: "https://astro.example.com/solar",
        sourceLabel: "bing images · via SearXNG (self-hosted)",
      },
    },
  };

  for (const definition of IMAGE_SOURCE_DEFINITIONS) {
    const fixture = engineFixtures[definition.sourceId]!;

    it(`${definition.sourceId}: builds the image request and parses the payload`, async () => {
      const descriptor = findWebSourceDescriptor(definition.sourceId)!;
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture.body));
      const source = new HttpImageSearchSource(
        descriptor,
        definition,
        { apiKey: "k", engineId: "cx", baseUrl: "https://searx.example.org" },
        { fetch: fetchMock as typeof fetch },
      );

      const results = await source.searchImages("solar system", { limit: 5 });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject(fixture.expected);
      expect(results[0]!.licensed).toBeUndefined();

      const [url, init] = fetchMock.mock.calls[0]!;
      const request = `${String(url)} ${JSON.stringify(init)}`;
      expect(request.toLowerCase()).toContain("image");
    });
  }

  it("covers every engine that declares image support", () => {
    const declared = WEB_SOURCE_CATALOG.filter((entry) => entry.capabilities?.images === true)
      .map((entry) => entry.id)
      .sort();
    expect(IMAGE_SOURCE_DEFINITIONS.map((entry) => entry.sourceId).sort()).toEqual(declared);
  });

  it("drops entries without a hosting page or image url", () => {
    expect(
      braveImageDefinition.parseResponse({ results: [{ title: "x" }] }, "Brave Search"),
    ).toEqual([]);
  });
});

describe("image source registry", () => {
  const profile = (sourceId: string, enabled: boolean): WebSourceProfile => ({
    sourceId,
    activation: enabled ? "auto" : "off",
    credentials: {},
  });

  it("builds nothing when both image resources are disabled", () => {
    expect(
      createImageSearchSources([
        profile(WIKIMEDIA_COMMONS_SOURCE_ID, false),
        profile(OPENVERSE_SOURCE_ID, false),
      ]),
    ).toEqual([]);
  });

  it("enables each image resource independently", () => {
    const commonsOnly = createImageSearchSources([
      profile(WIKIMEDIA_COMMONS_SOURCE_ID, true),
      profile(OPENVERSE_SOURCE_ID, false),
    ]);
    expect(commonsOnly.map((source) => source.descriptor.id)).toEqual([
      WIKIMEDIA_COMMONS_SOURCE_ID,
    ]);

    const openverseOnly = createImageSearchSources([profile(OPENVERSE_SOURCE_ID, true)]);
    expect(openverseOnly.map((source) => source.descriptor.id)).toEqual([OPENVERSE_SOURCE_ID]);
  });

  it("never enrols a general engine in image search without an explicit opt-in", () => {
    const textOnly = createImageSearchSources([
      { sourceId: "brave", activation: "auto", credentials: { apiKey: "k" } },
    ]);
    expect(textOnly).toEqual([]);
  });

  it("uses a general engine once the user opted it into image search", () => {
    const optedIn = createImageSearchSources([
      {
        sourceId: "brave",
        activation: "auto",
        credentials: { apiKey: "k" },
        imageSearchEnabled: true,
      },
    ]);
    expect(optedIn.map((source) => source.descriptor.id)).toEqual(["brave"]);
  });

  it("ignores the image opt-in while the engine itself is disabled", () => {
    const disabled = createImageSearchSources([
      {
        sourceId: "brave",
        activation: "off",
        credentials: { apiKey: "k" },
        imageSearchEnabled: true,
      },
    ]);
    expect(disabled).toEqual([]);
  });
});

describe("untrusted image provider responses", () => {
  function errorResponse(status: number): Response {
    return { ok: false, status, text: async () => "" } as Response;
  }

  function commonsSource(fetchMock: typeof fetch): WikimediaCommonsImageSource {
    return new WikimediaCommonsImageSource(findWebSourceDescriptor(WIKIMEDIA_COMMONS_SOURCE_ID)!, {
      fetch: fetchMock,
    });
  }

  function openverseSource(fetchMock: typeof fetch): OpenverseImageSource {
    return new OpenverseImageSource(
      findWebSourceDescriptor(OPENVERSE_SOURCE_ID)!,
      {},
      { fetch: fetchMock },
    );
  }

  for (const status of [429, 500, 503]) {
    it(`reports HTTP ${status} as a failure instead of an empty result set`, async () => {
      const commonsFetch = vi.fn().mockResolvedValue(errorResponse(status));
      await expect(
        commonsSource(commonsFetch as unknown as typeof fetch).searchImages("cats"),
      ).rejects.toMatchObject({
        code: "WEB_SEARCH_FAILED",
        message: expect.stringContaining(String(status)),
      });

      const openverseFetch = vi.fn().mockResolvedValue(errorResponse(status));
      await expect(
        openverseSource(openverseFetch as unknown as typeof fetch).searchImages("cats"),
      ).rejects.toMatchObject({
        code: "WEB_SEARCH_FAILED",
        message: expect.stringContaining(String(status)),
      });
    });
  }

  it("reports a truncated Openverse body as malformed rather than parsing a partial payload", async () => {
    const truncated = JSON.stringify(openverseBody).slice(0, 120);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => truncated } as Response);

    await expect(
      openverseSource(fetchMock as unknown as typeof fetch).searchImages("mountains"),
    ).rejects.toThrow(/malformed/);
  });

  it("reports a truncated Commons body as malformed rather than parsing a partial payload", async () => {
    const serialized = JSON.stringify(commonsBody);

    for (const truncated of [
      serialized.slice(0, 120),
      serialized.slice(0, serialized.length - 4),
    ]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, text: async () => truncated } as Response);

      await expect(
        commonsSource(fetchMock as unknown as typeof fetch).searchImages("cats"),
      ).rejects.toMatchObject({
        code: "WEB_SEARCH_FAILED",
        message: expect.stringContaining("malformed"),
      });
    }
  });

  it("reports a Commons stream that ends mid-payload as malformed", async () => {
    const serialized = JSON.stringify(commonsBody);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(streamingResponse([serialized.slice(0, 40), serialized.slice(40, 90)]));

    await expect(
      commonsSource(fetchMock as unknown as typeof fetch).searchImages("cats"),
    ).rejects.toThrow(/malformed/);
  });

  it("yields no candidates for JSON of the wrong shape", () => {
    expect(parseOpenversePayload(null)).toEqual([]);
    expect(parseOpenversePayload("results")).toEqual([]);
    expect(parseOpenversePayload({ results: "not-a-list" })).toEqual([]);
    expect(parseOpenversePayload({ results: [42, null, "x"] })).toEqual([]);

    expect(parseCommonsPayload(null)).toEqual([]);
    expect(parseCommonsPayload([{ query: {} }])).toEqual([]);
    expect(parseCommonsPayload({ query: { pages: { "0": {} } } })).toEqual([]);
    expect(parseCommonsPayload({ query: { pages: [7] } })).toEqual([]);
  });

  it("yields no candidates for an empty result array", async () => {
    expect(parseOpenversePayload({ results: [] })).toEqual([]);
    expect(parseCommonsPayload({ query: { pages: [] } })).toEqual([]);

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    await expect(
      openverseSource(fetchMock as unknown as typeof fetch).searchImages("mountains"),
    ).resolves.toEqual([]);
  });

  it("drops Openverse results missing a required field", () => {
    const complete = openverseBody.results[0]!;
    for (const missing of ["id", "url", "foreign_landing_url"] as const) {
      const entry: Record<string, unknown> = { ...complete };
      delete entry[missing];
      expect(parseOpenversePayload({ results: [entry] })).toEqual([]);
    }

    expect(
      parseOpenversePayload({ results: [{ ...complete, url: "https://example.org/photo" }] }),
    ).toEqual([]);
    const wrongTypedSize = parseOpenversePayload({
      results: [{ ...complete, width: "2000", height: null }],
    });
    expect(wrongTypedSize).toHaveLength(1);
    expect(wrongTypedSize[0]).not.toHaveProperty("width");
    expect(wrongTypedSize[0]).not.toHaveProperty("height");
  });

  it("drops Commons pages missing a required field", () => {
    const page = commonsBody.query.pages[0]!;
    const info = page.imageinfo[0]!;
    for (const missing of ["url", "descriptionurl"] as const) {
      const partial: Record<string, unknown> = { ...info };
      delete partial[missing];
      expect(
        parseCommonsPayload({ query: { pages: [{ ...page, imageinfo: [partial] }] } }),
      ).toEqual([]);
    }

    expect(
      parseCommonsPayload({
        query: { pages: [{ ...page, imageinfo: [{ ...info, mime: "text/html", url: "a/b" }] }] },
      }),
    ).toEqual([]);
    const wrongTypedSize = parseCommonsPayload({
      query: { pages: [{ ...page, imageinfo: [{ ...info, width: null, height: "800" }] }] },
    });
    expect(wrongTypedSize).toHaveLength(1);
    expect(wrongTypedSize[0]).not.toHaveProperty("width");
    expect(wrongTypedSize[0]).not.toHaveProperty("height");
  });
});
