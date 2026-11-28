import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { InMemoryPageCacheStore } from "@adapters/research-tools/web/InMemoryPageCacheStore";
import { FindInPagesTool, ReadPageRangeTool } from "@adapters/research-tools/web/PageSearchTools";
import { WebFetchResearchTool } from "@adapters/research-tools/web/WebFetchResearchTool";
import type { SearchProvider } from "@application/ports";
import { executeTool, type Tool } from "@core/agent";
import {
  BATCH_OUTPUT_CHARS,
  MAX_FIND_RESULT_CHARS,
  PAGE_EVIDENCE_HEAD_CHARS,
  PAGE_HEAD_CHARS,
} from "@core/web";

const DEEP = "Open-source models are exempt from Article 53(2) documentation duties.";
const FILLER = "lorem ipsum dolor sit amet consectetur. ";
const BIG = `# Regulation\n${FILLER.repeat(7_000)}${DEEP} ${FILLER.repeat(3_000)}`;
const URL = "https://example.com/regulation";

function provider(content: string): SearchProvider {
  return {
    search: vi.fn(),
    fetchPage: async (url) => ({
      ok: true as const,
      url,
      finalUrl: url,
      content,
      contentType: "text/html",
      bytes: content.length,
      truncated: false,
      redirects: [url],
    }),
  };
}

function session(store: InMemoryPageCacheStore, sessionId: string) {
  let sequence = 0;
  const evidence = new ResearchEvidenceRegistry({
    createHandle: () => `${sessionId}-handle-${sequence++}`,
  });
  const pageCache = store.forSession(sessionId);
  const call = (tool: Tool, name: string, args: object) =>
    executeTool(tool, { id: "call", name, arguments: args as Record<string, unknown> });
  return {
    evidence,
    pageCache,
    register: (url = URL) =>
      evidence.registerWebResult(
        { url, title: "Reg", snippet: "snip", rank: 1 },
        { callId: "s", query: "q" },
      ),
    find: (args: object) =>
      call(new FindInPagesTool({ evidence, pageCache }), "find_in_pages", args),
    read: (args: object) =>
      call(new ReadPageRangeTool({ evidence, pageCache }), "read_page_range", args),
    fetchTool: (content: string) =>
      new WebFetchResearchTool({ provider: provider(content), evidence, pageCache }),
    call,
  };
}

async function fetched(content: string, store = new InMemoryPageCacheStore(), sessionId = "s1") {
  const s = session(store, sessionId);
  const registered = s.register();
  const execution = await s.call(s.fetchTool(content), "fetch_web_page", {
    resultIds: [registered.resultId],
  });
  return { ...s, registered, execution, store };
}

describe("page search tools", () => {
  it("returns a compact result for a large page, the whole text for a small one, and keeps the head as evidence", async () => {
    const large = await fetched(BIG);
    const small = await fetched("A short page.");

    const largePage = (large.execution as { value: { pages: Record<string, unknown>[] } }).value
      .pages[0]!;
    expect(largePage).toMatchObject({ ok: true, totalChars: BIG.length });
    expect(largePage).not.toHaveProperty("content");
    expect((largePage.head as string).length).toBe(PAGE_HEAD_CHARS);
    expect(largePage.outline).toEqual([{ offset: 0, title: "# Regulation" }]);
    expect(largePage.hint).toEqual(expect.stringContaining("find_in_pages"));
    expect(large.evidence.snapshot().evidence[0]!.text).toHaveLength(PAGE_EVIDENCE_HEAD_CHARS);
    expect(large.pageCache.get(large.registered.evidenceId)?.text).toHaveLength(BIG.length);
    expect(
      (small.execution as { value: { pages: Record<string, unknown>[] } }).value.pages[0],
    ).toMatchObject({ content: "A short page.", totalChars: 13 });
  });

  it("bounds the serialized result of a batch fetch and of a search over many pages", async () => {
    const s = session(new InMemoryPageCacheStore(), "s1");
    const longPath = "p".repeat(1_300);
    const ids = Array.from({ length: 10 }, (_, index) =>
      s.register(`https://example.com/${index}/${longPath}`),
    );
    const fetchedBatch = await s.call(s.fetchTool("w".repeat(8_000)), "fetch_web_page", {
      resultIds: ids.map((entry) => entry.resultId),
    });
    const none = await s.find({ query: "zzzz absent" });

    expect(JSON.stringify(none).length).toBeLessThanOrEqual(MAX_FIND_RESULT_CHARS);
    expect((none as { value: { omittedPages?: number } }).value.omittedPages).toBeGreaterThan(0);
    const pages = (fetchedBatch as { value: { pages: Record<string, unknown>[] } }).value.pages;
    expect(pages.every((page) => !("content" in page))).toBe(true);
    const compact = await fetched("w".repeat(8_000));
    const single = (compact.execution as { value: { pages: { content?: string }[] } }).value
      .pages[0];
    expect(single?.content).toHaveLength(8_000);
  });

  it("answers a batch of ordinary pages within the batch output budget", async () => {
    const s = session(new InMemoryPageCacheStore(), "s1");
    const ids = Array.from({ length: 10 }, (_, index) =>
      s.register(`https://example.com/page-${index}`),
    );
    const batch = await s.call(s.fetchTool(BIG), "fetch_web_page", {
      resultIds: ids.map((entry) => entry.resultId),
    });

    expect(JSON.stringify(batch).length).toBeLessThanOrEqual(BATCH_OUTPUT_CHARS + 1_000);
  });

  it("finds a passage deep in a cached page, bounds the output and registers the passage as evidence", async () => {
    const page = await fetched(BIG);

    const deep = await page.find({ query: "article 53(2) documentation", mode: "keywords" });
    const wide = await page.find({ query: "lorem", limit: 20, context: 1_000 });

    const found = (deep as { value: { matches: { text: string; resultId: string }[] } }).value;
    expect(found.matches[0]!.text).toContain(DEEP);
    expect(found.matches[0]!.resultId).toBe(page.registered.resultId);
    expect(page.evidence.snapshot().evidence[0]!.text).toContain(DEEP);
    const bounded = (wide as { value: { matches: { text: string }[]; truncatedMatches: boolean } })
      .value;
    expect(bounded.truncatedMatches).toBe(true);
    expect(
      bounded.matches.reduce((total, match) => total + match.text.length, 0),
    ).toBeLessThanOrEqual(MAX_FIND_RESULT_CHARS);
  });

  it("reads a range of a cached page, registers it and reports where to continue", async () => {
    const page = await fetched(BIG);
    const offset = BIG.indexOf(DEEP);

    const read = await page.read({ resultId: page.registered.resultId, offset, length: 500 });

    const value = (read as { value: { text: string; nextOffset: number; totalChars: number } })
      .value;
    expect(value.text).toContain(DEEP);
    expect(value).toMatchObject({ totalChars: BIG.length });
    expect(value.nextOffset).toBeGreaterThan(offset);
    expect(page.evidence.snapshot().evidence[0]!.text).toContain(DEEP);
  });

  it("answers every miss with the same error and rejects malformed arguments", async () => {
    const store = new InMemoryPageCacheStore();
    const owner = await fetched(BIG, store, "one");
    const other = session(store, "two");
    const foreign = other.register();
    const small = await fetched(
      BIG,
      new InMemoryPageCacheStore({
        maxPageChars: 1_000_000,
        maxSessionChars: BIG.length + 50,
        maxTotalChars: 10_000_000,
      }),
    );
    small.pageCache.put({
      evidenceId: "filler",
      url: "https://example.com/filler",
      finalUrl: "https://example.com/filler",
      title: "Filler",
      snippet: "",
      contentType: "text/html",
      text: "y".repeat(100),
      truncated: false,
    });

    const empty = await other.find({ query: "lorem" });
    const unknown = await owner.read({ resultId: "missing", offset: 0 });
    const foreignRead = await other.read({ resultId: foreign.resultId, offset: 0 });
    const foreignFind = await owner.find({ query: "lorem", resultIds: ["missing"] });
    const evicted = await small.read({ resultId: small.registered.resultId, offset: 0 });

    expect(empty).toMatchObject({ ok: false, error: { code: "no-pages-fetched" } });
    const messages = [unknown, foreignRead, foreignFind, evicted].map((result) => {
      expect(result).toMatchObject({ ok: false, error: { code: "page-not-in-session" } });
      return (result as { error: { message: string } }).error.message;
    });
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toContain("fetch_web_page");
    await other.call(other.fetchTool("own lorem page"), "fetch_web_page", {
      resultIds: [foreign.resultId],
    });
    const own = (await other.find({ query: "lorem" })) as {
      value: { matches: { text: string }[]; pages: unknown[] };
    };
    expect([own.value.pages.length, own.value.matches.some((m) => m.text.includes(DEEP))]).toEqual([
      1,
      false,
    ]);
    expect(await owner.find({ query: "  " })).toMatchObject({ error: { code: "invalid-query" } });
    expect(await owner.read({ resultId: "x", offset: -1 })).toMatchObject({
      error: { code: "invalid-offset" },
    });
  });

  it("lets a later run of the same session search a page an earlier run fetched", async () => {
    const store = new InMemoryPageCacheStore();
    await fetched(BIG, store, "one");
    const later = session(store, "one");

    const found = await later.find({ query: "article 53(2)" });

    expect((found as { value: { matches: { text: string }[] } }).value.matches[0]!.text).toContain(
      DEEP,
    );
    expect(later.evidence.snapshot().evidence[0]!.text).toContain(DEEP);
  });
});
