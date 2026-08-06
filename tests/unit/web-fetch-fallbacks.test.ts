import { WebSourceProfile } from "@core/web";
import {
  createFetchFallbackProviders,
  JinaReaderFetchProvider,
  WaybackFetchProvider,
  ZyteFetchProvider,
} from "@adapters/web";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("JinaReaderFetchProvider", () => {
  it("fetches r.jina.ai with the key and returns markdown content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { content: "# Page\ntext", url: "https://a.dev/final" } }),
      );
    const provider = new JinaReaderFetchProvider("key-1", { fetch: fetchMock as typeof fetch });

    const page = await provider.fetchPage("https://a.dev/");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://r.jina.ai/https://a.dev/");
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.authorization).toBe("Bearer key-1");
    expect(page).toMatchObject({
      ok: true,
      finalUrl: "https://a.dev/final",
      content: "# Page\ntext",
      contentType: "text/markdown",
    });
  });

  it("fails on empty content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { content: "" } }));
    const provider = new JinaReaderFetchProvider("key", { fetch: fetchMock as typeof fetch });
    await expect(provider.fetchPage("https://a.dev/")).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-empty-content" },
    });
  });
});

describe("ZyteFetchProvider", () => {
  it("posts to the extract endpoint with basic auth and extracts readable text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        url: "https://a.dev/",
        browserHtml: "<html><body><article><p>Useful text.</p></article></body></html>",
      }),
    );
    const provider = new ZyteFetchProvider("zyte-key", { fetch: fetchMock as typeof fetch });

    const page = await provider.fetchPage("https://a.dev/");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.zyte.com/v1/extract");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers?.authorization).toBe(
      `Basic ${Buffer.from("zyte-key:", "utf8").toString("base64")}`,
    );
    expect(JSON.parse(init?.body as string)).toEqual({ url: "https://a.dev/", browserHtml: true });
    expect(page).toMatchObject({ ok: true, content: expect.stringContaining("Useful text.") });
  });
});

describe("WaybackFetchProvider", () => {
  it("resolves the closest snapshot and fetches it through the page fetcher", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        archived_snapshots: {
          closest: { available: true, url: "http://web.archive.org/web/2026/https://a.dev/" },
        },
      }),
    );
    const innerFetchPage = vi.fn().mockResolvedValue({ ok: true, content: "archived" });
    const provider = new WaybackFetchProvider(
      { fetchPage: innerFetchPage },
      { fetch: fetchMock as typeof fetch },
    );

    const page = await provider.fetchPage("https://a.dev/");
    expect(innerFetchPage).toHaveBeenCalledWith(
      "https://web.archive.org/web/2026/https://a.dev/",
      expect.anything(),
    );
    expect(page).toMatchObject({ ok: true, content: "archived" });
  });

  it("fails cleanly when no snapshot exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ archived_snapshots: {} }));
    const provider = new WaybackFetchProvider(
      { fetchPage: vi.fn() },
      { fetch: fetchMock as typeof fetch },
    );
    await expect(provider.fetchPage("https://a.dev/")).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-no-snapshot" },
    });
  });
});

describe("createFetchFallbackProviders", () => {
  const pageFetcher = { fetchPage: vi.fn() };

  it("includes Jina and Zyte only when enabled with a key; Wayback always closes the chain", () => {
    const profiles: WebSourceProfile[] = [
      { sourceId: "jina", activation: "auto", credentials: { apiKey: "j" } },
      { sourceId: "zyte", activation: "off", credentials: { apiKey: "z" } },
    ];
    const providers = createFetchFallbackProviders(profiles, pageFetcher);
    expect(providers.map((provider) => provider.id)).toEqual(["jina", "wayback"]);
  });

  it("is wayback-only when nothing else is configured", () => {
    const providers = createFetchFallbackProviders([], pageFetcher);
    expect(providers.map((provider) => provider.id)).toEqual(["wayback"]);
  });
});
