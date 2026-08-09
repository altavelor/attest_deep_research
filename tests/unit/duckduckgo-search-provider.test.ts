import { DuckDuckGoSearchProvider } from "@adapters/web";

function htmlResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
    status: 200,
    ...init,
  });
}

describe("DuckDuckGoSearchProvider", () => {
  it("searches DuckDuckGo with only the user query and fetches bounded result pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse(`
          <html>
            <body>
              <div class="result">
                <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fresearch%3Fq%3Dlocal&amp;rut=abc">Example research</a>
                <a class="result__snippet">A concise result about local models.</a>
              </div>
              <div class="result">
                <a class="result__a" href="https://second.example.com/">Second result</a>
                <a class="result__snippet">A second concise result.</a>
              </div>
              <div class="result">
                <a class="result__a" href="https://third.example.com/">Third result</a>
                <a class="result__snippet">A third concise result.</a>
              </div>
            </body>
          </html>
        `),
      )
      .mockResolvedValueOnce(
        htmlResponse(`
          <html>
            <head><title>Example research</title></head>
            <body>
              <nav>Skip this navigation</nav>
              <article>
                <h1>Local model research</h1>
                <p>First useful paragraph.</p>
                <script>privateNoise()</script>
                <p>Second useful paragraph.</p>
              </article>
            </body>
          </html>
        `),
      )
      .mockResolvedValueOnce(
        htmlResponse(`
          <html>
            <body>
              <article>
                <h1>Second result</h1>
                <p>Second useful paragraph.</p>
              </article>
            </body>
          </html>
        `),
      );
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: fetchMock,
      now: fixedNow,
    });

    await expect(provider.search("local models", { limit: 3, maxFetches: 2 })).resolves.toEqual([
      {
        source: {
          id: "web:https://example.com/research?q=local",
          kind: "web",
          title: "Example research",
          url: "https://example.com/research?q=local",
          snippet: "A concise result about local models.",
          retrievedAt: "2026-05-16T00:00:00.000Z",
          wasContentFetched: true,
        },
        extractedText:
          "Example research Local model research First useful paragraph. Second useful paragraph.",
        rank: 1,
        query: "local models",
      },
      {
        source: {
          id: "web:https://second.example.com/",
          kind: "web",
          title: "Second result",
          url: "https://second.example.com/",
          snippet: "A second concise result.",
          retrievedAt: "2026-05-16T00:00:00.000Z",
          wasContentFetched: true,
        },
        extractedText: "Second result Second useful paragraph.",
        rank: 2,
        query: "local models",
      },
      {
        source: {
          id: "web:https://third.example.com/",
          kind: "web",
          title: "Third result",
          url: "https://third.example.com/",
          snippet: "A third concise result.",
          retrievedAt: "2026-05-16T00:00:00.000Z",
          wasContentFetched: false,
        },
        rank: 3,
        query: "local models",
      },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://html.duckduckgo.com/html/?q=local+models",
      expect.objectContaining({ method: "GET" }),
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("vault secret");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.com/research?q=local",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://second.example.com/",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the configured default result limit when no per-call limit is given", async () => {
    const resultsHtml = Array.from(
      { length: 8 },
      (_, index) => `
      <div class="result">
        <a class="result__a" href="https://example.com/r${index}">Result ${index}</a>
        <a class="result__snippet">Snippet ${index}</a>
      </div>`,
    ).join("");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(htmlResponse(`<html><body>${resultsHtml}</body></html>`));
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: fetchMock,
      now: fixedNow,
      defaultResultLimit: 7,
    });

    const results = await provider.search("local models", { maxFetches: 0 });

    expect(results).toHaveLength(7);
  });

  it("lets a per-call limit override the configured default", async () => {
    const resultsHtml = Array.from(
      { length: 8 },
      (_, index) => `
      <div class="result">
        <a class="result__a" href="https://example.com/r${index}">Result ${index}</a>
        <a class="result__snippet">Snippet ${index}</a>
      </div>`,
    ).join("");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(htmlResponse(`<html><body>${resultsHtml}</body></html>`));
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: fetchMock,
      now: fixedNow,
      defaultResultLimit: 7,
    });

    const results = await provider.search("local models", { limit: 2, maxFetches: 0 });

    expect(results).toHaveLength(2);
  });

  it("retries a rate-limited search response then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        htmlResponse(`
          <a href="https://example.com/research" class="result__a">Example research</a>
          <a class="result__snippet">Snippet text</a>
        `),
      );
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      maxSearchRetries: 2,
      rateLimitBackoffMs: 1,
      fetch: fetchMock,
      now: fixedNow,
    });

    const results = await provider.search("local models", { limit: 1, maxFetches: 0 });

    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting rate-limit retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse("rate limited", { status: 429 }));
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      maxSearchRetries: 2,
      rateLimitBackoffMs: 1,
      fetch: fetchMock,
    });

    await expect(provider.search("local models")).rejects.toMatchObject({
      code: "WEB_SEARCH_FAILED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("calls fetch with the global receiver for browser compatibility", async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }

      return Promise.resolve(htmlResponse("<html><body>No results</body></html>"));
    }) as typeof fetch;
    const provider = new DuckDuckGoSearchProvider({ minRequestIntervalMs: 0, fetch: fetchMock });

    await expect(provider.search("local models")).resolves.toEqual([]);
  });

  it("returns an unfetched web source when a result page cannot be fetched", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse(`
          <a href="https://example.com/research" class="result__a">Example research</a>
          <a class="result__snippet">Snippet text</a>
        `),
      )
      .mockResolvedValueOnce(htmlResponse("not found", { status: 404 }));
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: fetchMock,
      now: fixedNow,
    });

    await expect(provider.search("local models", { limit: 1, maxFetches: 1 })).resolves.toEqual([
      expect.objectContaining({
        source: expect.objectContaining({
          url: "https://example.com/research",
          wasContentFetched: false,
        }),
      }),
    ]);
  });

  it("keeps the web source when fetching the first result page has a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse(`
          <a href="https://example.com/research" class="result__a">Example research</a>
          <a class="result__snippet">Snippet text</a>
        `),
      )
      .mockRejectedValueOnce(new TypeError("result page unavailable"));
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: fetchMock,
      now: fixedNow,
    });

    await expect(provider.search("local models", { limit: 1, maxFetches: 1 })).resolves.toEqual([
      {
        source: {
          id: "web:https://example.com/research",
          kind: "web",
          title: "Example research",
          url: "https://example.com/research",
          snippet: "Snippet text",
          retrievedAt: "2026-05-16T00:00:00.000Z",
          wasContentFetched: false,
        },
        rank: 1,
        query: "local models",
      },
    ]);
  });

  it("returns an empty list when DuckDuckGo has no organic result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(htmlResponse("<html><body>No results</body></html>"));
    const provider = new DuckDuckGoSearchProvider({ minRequestIntervalMs: 0, fetch: fetchMock });

    await expect(provider.search("zzzz")).resolves.toEqual([]);
  });

  it("keeps metadata-only search to one request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      htmlResponse(`
        <a href="https://example.com/research" class="result__a">Example research</a>
        <a class="result__snippet">Snippet text</a>
      `),
    );
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: fetchMock,
      now: fixedNow,
    });

    const results = await provider.search("local models", { limit: 1, maxFetches: 0 });

    expect(results[0]?.source.wasContentFetched).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches a page with bounded content and manual redirect validation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { location: "https://www.example.com/final" },
        }),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          `<html><body><article>${"Useful content. ".repeat(20)}</article></body></html>`,
        ),
      );
    const provider = new DuckDuckGoSearchProvider({ minRequestIntervalMs: 0, fetch: fetchMock });

    const result = await provider.fetchPage("https://example.com/start", {
      maxContentChars: 80,
      maxRedirects: 2,
    });

    expect(result).toMatchObject({
      ok: true,
      url: "https://example.com/start",
      finalUrl: "https://www.example.com/final",
      truncated: true,
      redirects: ["https://www.example.com/final"],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.com/start",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("distinguishes URL, HTTP, content-type, size, and timeout failures", async () => {
    const privateProvider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: vi.fn(),
    });
    await expect(privateProvider.fetchPage("http://127.0.0.1/private")).resolves.toMatchObject({
      ok: false,
      error: { code: "unsafe-web-url", retryable: false },
    });

    const httpProvider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: vi.fn().mockResolvedValue(new Response("error", { status: 503 })),
    });
    await expect(httpProvider.fetchPage("https://example.com")).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-http", retryable: true, details: { status: 503 } },
    });

    const binaryProvider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response("binary", { headers: { "content-type": "application/octet-stream" } }),
        ),
    });
    await expect(binaryProvider.fetchPage("https://example.com")).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-content-type", retryable: false },
    });

    const largeProvider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: vi.fn().mockResolvedValue(htmlResponse("x".repeat(20))),
    });
    await expect(
      largeProvider.fetchPage("https://example.com", { maxResponseBytes: 10 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-response-too-large", retryable: false },
    });

    const timeoutProvider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: vi.fn((_url, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }) as typeof fetch,
    });
    await expect(
      timeoutProvider.fetchPage("https://example.com", { timeoutMs: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-timeout", retryable: true },
    });

    const brokenStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("connection reset"));
      },
    });
    const streamProvider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(brokenStream, { headers: { "content-type": "text/html" } }),
        ),
    });
    await expect(streamProvider.fetchPage("https://example.com")).resolves.toMatchObject({
      ok: false,
      error: { code: "web-fetch-network", retryable: true },
    });
  });

  it("maps DuckDuckGo failures to recoverable web search errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    const provider = new DuckDuckGoSearchProvider({ minRequestIntervalMs: 0, fetch: fetchMock });

    await expect(provider.search("local models")).rejects.toMatchObject({
      code: "WEB_SEARCH_FAILED",
    });
  });

  it("returns empty metadata for plain-text pages without trying to parse HTML", async () => {
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response("Plain report", { headers: { "content-type": "text/plain" } }),
        ),
    });

    await expect(provider.fetchMetadata("https://example.com/report.txt")).resolves.toEqual({
      ok: true,
      url: "https://example.com/report.txt",
      finalUrl: "https://example.com/report.txt",
      metadata: {},
    });
  });

  it("returns document bytes and preserves a safe content disposition", async () => {
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      fetch: vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="paper.pdf"',
          },
        }),
      ),
    });

    await expect(provider.fetchDocument("https://example.com/paper.pdf")).resolves.toMatchObject({
      ok: true,
      url: "https://example.com/paper.pdf",
      contentType: "application/pdf",
      contentDisposition: 'attachment; filename="paper.pdf"',
      bytes: 3,
      data: new Uint8Array([1, 2, 3]),
    });
  });
});

function fixedNow(): Date {
  return new Date("2026-05-16T00:00:00.000Z");
}

describe("DuckDuckGoSearchProvider result page throttling", () => {
  it("does not serialize result pages behind the DuckDuckGo request interval", async () => {
    const inFlight: string[] = [];
    let peakConcurrentPages = 0;
    let pending = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://html.duckduckgo.com/")) {
        return htmlResponse(`
          <html><body>
            <div class="result"><a class="result__a" href="https://a.example.com/">A</a><a class="result__snippet">a</a></div>
            <div class="result"><a class="result__a" href="https://b.example.com/">B</a><a class="result__snippet">b</a></div>
            <div class="result"><a class="result__a" href="https://c.example.com/">C</a><a class="result__snippet">c</a></div>
          </body></html>
        `);
      }
      inFlight.push(url);
      pending += 1;
      peakConcurrentPages = Math.max(peakConcurrentPages, pending);
      await new Promise((resolve) => setTimeout(resolve, 10));
      pending -= 1;
      return htmlResponse(
        `<html><body><article><p>Paragraph for ${url} with enough words to extract.</p></article></body></html>`,
      );
    });

    const provider = new DuckDuckGoSearchProvider({
      fetch: fetchMock as unknown as typeof fetch,
      minRequestIntervalMs: 1_000,
    });

    const results = await provider.search("local models", { limit: 3, maxFetches: 3 });

    expect(results).toHaveLength(3);
    expect(inFlight).toHaveLength(3);
    expect(peakConcurrentPages).toBeGreaterThan(1);
    expect(results.every((result) => result.source.wasContentFetched)).toBe(true);
  });

  it("skips a result page whose fetch throws instead of failing the search", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://html.duckduckgo.com/")) {
        return htmlResponse(`
          <html><body>
            <div class="result"><a class="result__a" href="https://a.example.com/">A</a><a class="result__snippet">a</a></div>
          </body></html>
        `);
      }
      return new Response(null, {
        status: 302,
        headers: { location: "http://[" },
      });
    });
    const provider = new DuckDuckGoSearchProvider({
      fetch: fetchMock as unknown as typeof fetch,
      minRequestIntervalMs: 0,
    });

    const results = await provider.search("local models", { limit: 1, maxFetches: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]!.source.wasContentFetched).toBe(false);
  });

  it("accepts a result page whose content type carries parameters", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://html.duckduckgo.com/")) {
        return htmlResponse(`
          <html><body>
            <div class="result"><a class="result__a" href="https://a.example.com/">A</a><a class="result__snippet">a</a></div>
          </body></html>
        `);
      }
      return new Response(
        "<html><body><article><p>Readable paragraph with enough words.</p></article></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" }, status: 200 },
      );
    });
    const provider = new DuckDuckGoSearchProvider({
      fetch: fetchMock as unknown as typeof fetch,
      minRequestIntervalMs: 0,
    });

    const results = await provider.search("local models", { limit: 1, maxFetches: 1 });

    expect(results[0]!.source.wasContentFetched).toBe(true);
    expect(results[0]!.extractedText).toContain("Readable paragraph");
  });

  it("skips a result page that cannot be fetched", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://html.duckduckgo.com/")) {
        return htmlResponse(`
          <html><body>
            <div class="result"><a class="result__a" href="https://a.example.com/">A</a><a class="result__snippet">a</a></div>
          </body></html>
        `);
      }
      return htmlResponse("nope", { status: 500 });
    });
    const provider = new DuckDuckGoSearchProvider({
      fetch: fetchMock as unknown as typeof fetch,
      minRequestIntervalMs: 0,
    });

    const results = await provider.search("local models", { limit: 1, maxFetches: 1 });

    expect(results).toHaveLength(1);
    expect(results[0]!.source.wasContentFetched).toBe(false);
    expect(results[0]!.extractedText).toBeUndefined();
  });
});

describe("DuckDuckGoSearchProvider cancellation", () => {
  function hangingFetch(): { fetch: typeof fetch; aborted: () => boolean } {
    let sawAbort = false;
    const impl = vi.fn((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted === true) {
          sawAbort = true;
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => {
          sawAbort = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    return { fetch: impl as unknown as typeof fetch, aborted: () => sawAbort };
  }

  it("aborts the outbound search request when the caller cancels mid-flight", async () => {
    const controller = new AbortController();
    const hanging = hangingFetch();
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      timeoutMs: 60_000,
      fetch: hanging.fetch,
    });

    const pending = provider.search("local models", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(hanging.aborted()).toBe(true);
  });

  it("does not start a search whose signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const hanging = hangingFetch();
    const provider = new DuckDuckGoSearchProvider({
      minRequestIntervalMs: 0,
      timeoutMs: 60_000,
      fetch: hanging.fetch,
    });

    await expect(provider.search("local models", { signal: controller.signal })).rejects.toThrow();
    expect(hanging.aborted()).toBe(true);
  });
});
