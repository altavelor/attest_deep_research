import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { executeTool } from "@core/agent";
import { WebFetchResearchTool } from "@adapters/research-tools/web/WebFetchResearchTool";
import { SearchProvider } from "@application/ports";
import { fetchRegisteredWebPage } from "@adapters/research-tools/web/fetchRegisteredWebPage";

describe("WebFetchResearchTool", () => {
  it("rejects unknown and cross-registry handles before network access", async () => {
    const fetchPage = vi.fn();
    const provider: SearchProvider = { search: vi.fn(), fetchPage };
    const owner = new ResearchEvidenceRegistry({ createHandle: () => "owner-handle" });
    const other = new ResearchEvidenceRegistry({ createHandle: () => "other-handle" });
    const registered = owner.registerWebResult(
      { url: "https://example.com", title: "Example", snippet: "Snippet", rank: 1 },
      { callId: "search", query: "query" },
    );
    const tool = new WebFetchResearchTool({ provider, evidence: other });

    const execution = await executeTool(tool, {
      id: "fetch",
      name: "fetch_web_page",
      arguments: { resultIds: [registered.resultId, "missing-handle"] },
    });
    expect(execution).toMatchObject({
      ok: true,
      value: {
        pages: [
          { ok: false, error: { code: "unknown-web-result" } },
          { ok: false, error: { code: "unknown-web-result" } },
        ],
        diagnostics: { requested: 2, fetched: 0, failed: 2 },
      },
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("rejects an empty resultIds array", async () => {
    const provider: SearchProvider = { search: vi.fn(), fetchPage: vi.fn() };
    const evidence = new ResearchEvidenceRegistry({ createHandle: () => "h" });
    const tool = new WebFetchResearchTool({ provider, evidence });

    await expect(
      executeTool(tool, { id: "fetch", name: "fetch_web_page", arguments: { resultIds: [] } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-result-id" } });
  });

  it("fetches registered URLs in parallel and upgrades evidence without changing citation identity", async () => {
    let handleSeq = 0;
    const fetchPage = vi.fn(async (url: string) => ({
      ok: true as const,
      url,
      finalUrl: url,
      content: `content of ${url}`,
      contentType: "text/html",
      bytes: 100,
      truncated: false,
      redirects: [url],
    }));
    const provider: SearchProvider = { search: vi.fn(), fetchPage };
    const evidence = new ResearchEvidenceRegistry({ createHandle: () => `page-${handleSeq++}` });
    const first = evidence.registerWebResult(
      { url: "https://a.example/article", title: "A", snippet: "sa", rank: 1 },
      { callId: "search", query: "query" },
    );
    const second = evidence.registerWebResult(
      { url: "https://b.example/article", title: "B", snippet: "sb", rank: 2 },
      { callId: "search", query: "query" },
    );
    const beforeIds = evidence.snapshot().citations.map((c) => c.id);
    const tool = new WebFetchResearchTool({ provider, evidence });

    const execution = await executeTool(tool, {
      id: "fetch",
      name: "fetch_web_page",
      arguments: { resultIds: [first.resultId, second.resultId] },
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(execution).toMatchObject({
      ok: true,
      value: {
        pages: [
          {
            ok: true,
            evidenceId: first.evidenceId,
            content: "content of https://a.example/article",
          },
          {
            ok: true,
            evidenceId: second.evidenceId,
            content: "content of https://b.example/article",
          },
        ],
        diagnostics: { requested: 2, fetched: 2, failed: 0, untrustedEvidence: true },
      },
    });
    expect(evidence.snapshot().citations.map((c) => c.id)).toEqual(beforeIds);
  });

  it("de-duplicates repeated resultIds", async () => {
    const fetchPage = vi.fn(async (url: string) => ({
      ok: true as const,
      url,
      finalUrl: url,
      content: "x",
      contentType: "text/html",
      bytes: 1,
      truncated: false,
      redirects: [url],
    }));
    const provider: SearchProvider = { search: vi.fn(), fetchPage };
    const evidence = new ResearchEvidenceRegistry({ createHandle: () => "dup-handle" });
    const registered = evidence.registerWebResult(
      { url: "https://example.com/article", title: "Article", snippet: "s", rank: 1 },
      { callId: "search", query: "query" },
    );
    const tool = new WebFetchResearchTool({ provider, evidence });

    const execution = await executeTool(tool, {
      id: "fetch",
      name: "fetch_web_page",
      arguments: { resultIds: [registered.resultId, registered.resultId] },
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(execution).toMatchObject({
      ok: true,
      value: { diagnostics: { requested: 1, fetched: 1 } },
    });
  });

  it("reports structured provider policy failures per page while keeping the batch ok", async () => {
    const provider: SearchProvider = {
      search: vi.fn(),
      fetchPage: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "web-fetch-timeout", message: "Page fetch timed out.", retryable: true },
      }),
    };
    const evidence = new ResearchEvidenceRegistry({ createHandle: () => "timeout-handle" });
    evidence.registerWebResult(
      { url: "https://example.com", title: "Example", snippet: "Snippet", rank: 1 },
      { callId: "search", query: "query" },
    );
    const tool = new WebFetchResearchTool({ provider, evidence });

    await expect(
      executeTool(tool, {
        id: "fetch",
        name: "fetch_web_page",
        arguments: { resultIds: ["timeout-handle"] },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        pages: [
          {
            ok: false,
            resultId: "timeout-handle",
            error: { code: "web-fetch-timeout", retryable: true },
          },
        ],
        diagnostics: { requested: 1, fetched: 0, failed: 1 },
      },
    });
  });
});

describe("WebFetchResearchTool download budget", () => {
  it("passes a smaller per-page byte ceiling as the batch grows", async () => {
    async function ceilingFor(pageCount: number): Promise<number | undefined> {
      const seen: Array<number | undefined> = [];
      const fetchPage: SearchProvider["fetchPage"] = async (url, options) => {
        seen.push(options?.maxResponseBytes);
        return {
          ok: true as const,
          url,
          finalUrl: url,
          content: "text",
          contentType: "text/html",
          bytes: 10,
          truncated: false,
          redirects: [],
        };
      };
      const provider: SearchProvider = { search: vi.fn(), fetchPage };
      let handle = 0;
      const evidence = new ResearchEvidenceRegistry({
        createHandle: () => `handle-${(handle += 1)}`,
      });
      const resultIds = Array.from(
        { length: pageCount },
        (_, index) =>
          evidence.registerWebResult(
            { url: `https://example.com/page-${index}`, title: "t", snippet: "s", rank: index + 1 },
            { callId: "search", query: "q" },
          ).resultId,
      );
      const tool = new WebFetchResearchTool({ provider, evidence });

      await executeTool(tool, { id: "fetch", name: "fetch_web_page", arguments: { resultIds } });

      return seen[0];
    }

    expect(await ceilingFor(1)).toBe(4_194_304);
    expect(await ceilingFor(8)).toBe(1_310_720);
  });
});

describe("WebFetchResearchTool cancellation", () => {
  it("passes the abort signal to every fetch and does not upgrade evidence after cancellation", async () => {
    const controller = new AbortController();
    const seenSignals: Array<AbortSignal | undefined> = [];
    const provider: SearchProvider = {
      search: vi.fn(),
      fetchPage: vi.fn(async (url, options) => {
        seenSignals.push(options?.signal);
        controller.abort();
        return {
          ok: true as const,
          url,
          finalUrl: url,
          content: "late content",
          contentType: "text/html",
          bytes: 12,
          truncated: false,
          redirects: [],
        };
      }),
    };
    const evidence = new ResearchEvidenceRegistry();
    const resultId = evidence.registerWebResult(
      { url: "https://example.com/page", title: "t", snippet: "s", rank: 1 },
      { callId: "search", query: "q" },
    ).resultId;
    const tool = new WebFetchResearchTool({ provider, evidence });

    const execution = await executeTool(
      tool,
      { id: "fetch", name: "fetch_web_page", arguments: { resultIds: [resultId] } },
      { signal: controller.signal },
    );

    expect(seenSignals).toEqual([controller.signal]);
    expect(execution).toMatchObject({
      ok: true,
      value: { pages: [{ ok: false, error: { code: "web-fetch-cancelled" } }] },
    });
    expect(evidence.snapshot().evidence[0]?.source).toMatchObject({ wasContentFetched: false });
  });

  it.each(["throws", "returns failure"])(
    "classifies cancellation before a provider that %s",
    async (behavior) => {
      const controller = new AbortController();
      const evidence = new ResearchEvidenceRegistry();
      const resultId = evidence.registerWebResult(
        { url: "https://example.com/page", title: "t", snippet: "s", rank: 1 },
        { callId: "search", query: "q" },
      ).resultId;
      const provider: SearchProvider = {
        search: vi.fn(),
        fetchPage: vi.fn(async () => {
          controller.abort();
          if (behavior === "throws") throw new DOMException("aborted", "AbortError");
          return {
            ok: false as const,
            error: { code: "web-fetch-timeout", message: "timeout", retryable: true },
          };
        }),
      };

      const execution = await fetchRegisteredWebPage(
        { provider, evidence },
        resultId,
        "fetch",
        undefined,
        undefined,
        controller.signal,
      );

      expect(execution).toMatchObject({
        ok: false,
        error: { code: "web-fetch-cancelled", retryable: false },
      });
    },
  );
});
