import { InMemoryPageCacheStore } from "@adapters/research-tools/web/InMemoryPageCacheStore";
import type { CachedPage } from "@application/ports";
import { pageCacheLimits } from "@core/web";

function page(evidenceId: string, text: string): CachedPage {
  return {
    evidenceId,
    url: `https://example.com/${evidenceId}`,
    finalUrl: `https://example.com/${evidenceId}`,
    title: evidenceId,
    snippet: "",
    contentType: "text/html",
    text,
    truncated: false,
    version: evidenceId,
  };
}

const limits = { maxPageChars: 10, maxSessionChars: 20, maxTotalChars: 30 };

describe("in-memory page cache store", () => {
  it("keeps runs and sessions apart and drops the pages of a closed run", () => {
    const chat = new InMemoryPageCacheStore(limits).createChat();
    const run = chat.openRun();
    const session = chat.openSession("one");
    run.put(page("a", "aaaa"));

    expect(session.get("a")).toBeUndefined();
    expect(chat.openRun().get("a")).toBeUndefined();
    run.close();
    run.put(page("b", "bbbb"));
    expect(run.list()).toEqual([]);
  });

  it("refuses the page a fetch in flight stores after its session was closed, even through a reopened handle", () => {
    const chat = new InMemoryPageCacheStore(limits).createChat();
    const session = chat.openSession("one");
    session.put(page("a", "aaaa"));
    chat.closeSession("one");
    session.put(page("b", "bbbb"));
    chat.openSession("one").put(page("c", "cccc"));

    expect(session.list()).toEqual([]);
    expect(chat.sessionPages("one")).toBeUndefined();
    chat.openSession("two").put(page("d", "dddd"));
    expect(chat.sessionPages("two")?.list()).toHaveLength(1);
  });

  it("lets the chat read the pages of a session, and closing the chat drops every cache", () => {
    const chat = new InMemoryPageCacheStore(limits).createChat();
    const session = chat.openSession("one");
    const run = chat.openRun();
    session.put(page("a", "aaaa"));
    run.put(page("b", "bbbb"));

    expect(chat.sessionPages("one")?.get("a")?.text).toBe("aaaa");
    expect(chat.sessionPages("none")).toBeUndefined();
    chat.close();
    chat.openRun().put(page("c", "cccc"));
    expect([session.list(), run.list(), chat.sessionPages("one")]).toEqual([[], [], undefined]);
  });

  it("cuts a page over the page cap and flags it as truncated", () => {
    const cache = new InMemoryPageCacheStore(limits).createChat().openRun();
    cache.put(page("a", "x".repeat(25)));

    expect(cache.get("a")).toMatchObject({ text: "x".repeat(10), truncated: true });
  });

  it("evicts the least recently used whole page over the session cap and keeps the new one", () => {
    const cache = new InMemoryPageCacheStore(limits).createChat().openRun();
    cache.put(page("a", "x".repeat(10)));
    cache.put(page("b", "y".repeat(10)));
    cache.get("a");
    cache.put(page("c", "z".repeat(10)));

    expect(cache.list().map((entry) => entry.evidenceId)).toEqual(["a", "c"]);
  });

  it("evicts the least recently used page of any chat over the total cap", () => {
    const store = new InMemoryPageCacheStore(limits);
    const first = store.createChat().openRun();
    const second = store.createChat().openRun();
    first.put(page("a", "x".repeat(10)));
    first.put(page("b", "y".repeat(10)));
    second.put(page("c", "z".repeat(10)));
    second.put(page("d", "w".repeat(10)));

    expect([first.get("a"), first.get("b")?.evidenceId, second.get("d")?.evidenceId]).toEqual([
      undefined,
      "b",
      "d",
    ]);
  });

  it("quarters the caps on mobile", () => {
    expect(pageCacheLimits(true).maxSessionChars * 4).toBe(pageCacheLimits(false).maxSessionChars);
  });
});
