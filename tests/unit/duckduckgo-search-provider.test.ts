import { DuckDuckGoSearchProvider } from "../../src/web/DuckDuckGoSearchProvider";

function htmlResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
    status: 200,
    ...init,
  });
}

describe("DuckDuckGoSearchProvider", () => {
  it("searches DuckDuckGo with only the user query and fetches the first result page", async () => {
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
      );
    const provider = new DuckDuckGoSearchProvider({ fetch: fetchMock, now: fixedNow });

    await expect(provider.searchFirstResult("local models")).resolves.toEqual({
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
    });

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
  });

  it("returns an unfetched web source when the first result page cannot be fetched", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse(`
          <a href="https://example.com/research" class="result__a">Example research</a>
          <a class="result__snippet">Snippet text</a>
        `),
      )
      .mockResolvedValueOnce(htmlResponse("not found", { status: 404 }));
    const provider = new DuckDuckGoSearchProvider({ fetch: fetchMock, now: fixedNow });

    await expect(provider.searchFirstResult("local models")).resolves.toEqual({
      source: expect.objectContaining({
        url: "https://example.com/research",
        wasContentFetched: false,
      }),
    });
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
    const provider = new DuckDuckGoSearchProvider({ fetch: fetchMock, now: fixedNow });

    await expect(provider.searchFirstResult("local models")).resolves.toEqual({
      source: {
        id: "web:https://example.com/research",
        kind: "web",
        title: "Example research",
        url: "https://example.com/research",
        snippet: "Snippet text",
        retrievedAt: "2026-05-16T00:00:00.000Z",
        wasContentFetched: false,
      },
    });
  });

  it("returns null when DuckDuckGo has no organic result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(htmlResponse("<html><body>No results</body></html>"));
    const provider = new DuckDuckGoSearchProvider({ fetch: fetchMock });

    await expect(provider.searchFirstResult("zzzz")).resolves.toBeNull();
  });

  it("maps DuckDuckGo failures to recoverable web search errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
    const provider = new DuckDuckGoSearchProvider({ fetch: fetchMock });

    await expect(provider.searchFirstResult("local models")).rejects.toMatchObject({
      code: "WEB_SEARCH_FAILED",
    });
  });
});

function fixedNow(): Date {
  return new Date("2026-05-16T00:00:00.000Z");
}
