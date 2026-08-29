import { WebPageFetcher, isDocumentContentType } from "@adapters/web/WebPageFetcher";
import { HostRequestThrottle } from "@adapters/web/HostRequestThrottle";
import { responseBytesForBatch } from "@adapters/research-tools/web/fetchRegisteredWebPage";

function streamOf(chunks: Uint8Array[], pulls: { count: number }): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      pulls.count += 1;
      controller.enqueue(chunks[index]);
      index += 1;
    },
  });
}

function fetcherFor(
  chunks: Uint8Array[],
  contentType: string,
  pulls = { count: 0 },
  headers: Record<string, string> = {},
) {
  const requestPage = vi.fn(
    async () =>
      new Response(streamOf(chunks, pulls), {
        status: 200,
        headers: { "content-type": contentType, ...headers },
      }),
  );
  const fetcher = new WebPageFetcher({
    requestPage,
    throttle: new HostRequestThrottle({ perHostIntervalMs: 0 }),
    defaultTimeoutMs: 1_000,
  });
  return { fetcher, pulls, requestPage };
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("WebPageFetcher size handling for text pages", () => {
  it("truncates an oversized html page instead of failing it", async () => {
    const lead = "<html><body><h1>Nvidia</h1><p>Founded in 1993 by Jensen Huang.</p>";
    const middle = "<p>filler</p>".repeat(500);
    const never = "<p>NEVER_READ</p>";
    const { fetcher } = fetcherFor([bytes(lead), bytes(middle), bytes(never)], "text/html");

    const result = await fetcher.fetch(
      "https://en.wikipedia.org/wiki/Nvidia",
      { maxResponseBytes: lead.length + 10 },
      undefined,
      true,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.byteLength).toBe(lead.length + 10);
    expect(result.rawText).toContain("Founded in 1993 by Jensen Huang.");
    expect(result.rawText).not.toContain("NEVER_READ");
  });

  it("reports a page that fits as not truncated", async () => {
    const html = "<html><body><p>short</p></body></html>";
    const { fetcher } = fetcherFor([bytes(html)], "text/html");

    const result = await fetcher.fetch(
      "https://example.com/a",
      { maxResponseBytes: 1_000 },
      undefined,
      true,
    );

    expect(result).toMatchObject({ ok: true, truncated: false, byteLength: html.length });
  });

  it("does not cut a multi-byte character in half", async () => {
    const text = "аналитика";
    const raw = bytes(text);
    const { fetcher } = fetcherFor([raw], "text/plain");

    const result = await fetcher.fetch(
      "https://example.com/a",
      { maxResponseBytes: raw.byteLength - 1 },
      undefined,
      true,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.rawText).not.toContain("�");
    expect(text.startsWith(result.rawText)).toBe(true);
  });

  it("ignores a content-length that overstates a text page", async () => {
    const html = "<html><body><p>lead</p></body></html>";
    const { fetcher } = fetcherFor(
      [bytes(html)],
      "text/html",
      { count: 0 },
      {
        "content-length": "99999999",
      },
    );

    const result = await fetcher.fetch(
      "https://example.com/a",
      { maxResponseBytes: 1_000 },
      undefined,
      true,
    );

    expect(result).toMatchObject({ ok: true, truncated: false });
  });
});

describe("WebPageFetcher size handling for binary documents", () => {
  it("still refuses an oversized document rather than truncating it", async () => {
    const { fetcher } = fetcherFor(
      [new Uint8Array(4_000), new Uint8Array(4_000)],
      "application/pdf",
    );

    const result = await fetcher.fetch(
      "https://example.com/a.pdf",
      { maxResponseBytes: 5_000 },
      isDocumentContentType,
    );

    expect(result).toMatchObject({
      ok: false,
      result: { ok: false, error: { code: "web-fetch-response-too-large" } },
    });
  });

  it("still refuses a document whose content-length exceeds the limit", async () => {
    const { fetcher, requestPage } = fetcherFor(
      [new Uint8Array(10)],
      "application/pdf",
      { count: 0 },
      { "content-length": "99999999" },
    );

    const result = await fetcher.fetch(
      "https://example.com/a.pdf",
      { maxResponseBytes: 5_000 },
      isDocumentContentType,
    );

    expect(result).toMatchObject({
      ok: false,
      result: { ok: false, error: { code: "web-fetch-response-too-large" } },
    });
    expect(requestPage).toHaveBeenCalledTimes(1);
  });
});

describe("batch download budget", () => {
  it("shrinks the per-page ceiling as the batch grows, with a floor", () => {
    expect(responseBytesForBatch(1)).toBe(4_194_304);
    expect(responseBytesForBatch(2)).toBe(4_194_304);
    expect(responseBytesForBatch(4)).toBe(2_621_440);
    expect(responseBytesForBatch(8)).toBe(1_310_720);
    expect(responseBytesForBatch(10)).toBe(1_048_576);
  });

  it("keeps the worst-case bytes in flight bounded across the allowed batch sizes", () => {
    for (const pages of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(responseBytesForBatch(pages) * pages).toBeLessThanOrEqual(10_485_760);
      expect(responseBytesForBatch(pages)).toBeGreaterThanOrEqual(1_048_576);
    }
  });

  it("tolerates a nonsensical page count", () => {
    expect(responseBytesForBatch(0)).toBe(4_194_304);
    expect(responseBytesForBatch(-3)).toBe(4_194_304);
  });
});

describe("truncation is opt-in per call, not inferred from content type", () => {
  it("refuses an oversized text/plain document instead of saving a partial file", async () => {
    const { fetcher } = fetcherFor(
      [bytes("a".repeat(4_000)), bytes("b".repeat(4_000))],
      "text/plain",
    );

    const result = await fetcher.fetch(
      "https://example.com/dump.txt",
      { maxResponseBytes: 5_000 },
      isDocumentContentType,
    );

    expect(result).toMatchObject({
      ok: false,
      result: { ok: false, error: { code: "web-fetch-response-too-large" } },
    });
  });

  it("defaults to refusing when the caller does not opt in", async () => {
    const { fetcher } = fetcherFor(
      [bytes("x".repeat(4_000)), bytes("y".repeat(4_000))],
      "text/html",
    );

    const result = await fetcher.fetch("https://example.com/a", { maxResponseBytes: 5_000 });

    expect(result).toMatchObject({
      ok: false,
      result: { ok: false, error: { code: "web-fetch-response-too-large" } },
    });
  });
});

describe("truncation boundary arithmetic", () => {
  it("does not mark a body that ends exactly on the limit as truncated", async () => {
    const html = "<p>exactly</p>";
    const { fetcher } = fetcherFor([bytes(html)], "text/html");

    const result = await fetcher.fetch(
      "https://example.com/a",
      { maxResponseBytes: html.length },
      undefined,
      true,
    );

    expect(result).toMatchObject({ ok: true, truncated: false, byteLength: html.length });
  });

  it("cuts inside the very first chunk when it alone exceeds the limit", async () => {
    const { fetcher } = fetcherFor([bytes("<p>lead and then a long tail</p>")], "text/html");

    const result = await fetcher.fetch(
      "https://example.com/a",
      { maxResponseBytes: 7 },
      undefined,
      true,
    );

    expect(result).toMatchObject({ ok: true, truncated: true, byteLength: 7 });
    if (!result.ok) return;
    expect(result.rawText).toBe("<p>lead");
  });

  it("keeps a multi-byte character that ends exactly on the limit", async () => {
    const raw = bytes("аб");
    const { fetcher } = fetcherFor([raw, bytes("в")], "text/plain");

    const result = await fetcher.fetch(
      "https://example.com/a",
      { maxResponseBytes: raw.byteLength },
      undefined,
      true,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawText).toBe("аб");
  });
});
