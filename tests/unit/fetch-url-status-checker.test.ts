import { FetchUrlStatusChecker } from "@adapters/web";

describe("FetchUrlStatusChecker", () => {
  it("classifies successful responses as reachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const checker = new FetchUrlStatusChecker({ fetch: fetchMock });

    await expect(checker.checkUrls([{ url: "https://example.com" }], options())).resolves.toEqual([
      expect.objectContaining({ state: "reachable", ok: true, status: 200 }),
    ]);
  });

  it("classifies missing pages as unreachable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const checker = new FetchUrlStatusChecker({ fetch: fetchMock });

    await expect(checker.checkUrls([{ url: "https://example.com/missing" }], options())).resolves.toEqual([
      expect.objectContaining({ state: "unreachable", ok: false, status: 404 }),
    ]);
  });

  it("classifies blocked and rate-limited responses as unknown", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(new Response("", { status: 429 }));
    const checker = new FetchUrlStatusChecker({ fetch: fetchMock });

    await expect(
      checker.checkUrls(
        [{ url: "https://seon.io/" }, { url: "https://example.com/rate-limited" }],
        options(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ state: "unknown", ok: false, status: 403 }),
      expect.objectContaining({ state: "unknown", ok: false, status: 429 }),
    ]);
  });

  it("classifies network exceptions as unknown", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const checker = new FetchUrlStatusChecker({ fetch: fetchMock });

    await expect(checker.checkUrls([{ url: "https://example.com" }], options())).resolves.toEqual([
      expect.objectContaining({ state: "unknown", ok: false, error: "TypeError" }),
    ]);
  });
});

function options(): { timeoutMs: number; signal: AbortSignal } {
  return { timeoutMs: 1_000, signal: new AbortController().signal };
}
