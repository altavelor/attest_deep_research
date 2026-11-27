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
  };
}

const limits = { maxPageChars: 10, maxSessionChars: 20, maxTotalChars: 30 };

describe("in-memory page cache store", () => {
  it("keeps sessions apart and forgets a released session", () => {
    const store = new InMemoryPageCacheStore(limits);
    store.forSession("one").put(page("a", "aaaa"));

    expect(store.forSession("two").get("a")).toBeUndefined();
    expect(store.forSession("one").get("a")?.text).toBe("aaaa");
    store.release("one");
    expect(store.forSession("one").list()).toEqual([]);
  });

  it("cuts a page over the page cap and flags it as truncated", () => {
    const cache = new InMemoryPageCacheStore(limits).forSession("one");
    cache.put(page("a", "x".repeat(25)));

    expect(cache.get("a")).toMatchObject({ text: "x".repeat(10), truncated: true });
  });

  it("evicts the least recently used whole page over the session cap and keeps the new one", () => {
    const cache = new InMemoryPageCacheStore(limits).forSession("one");
    cache.put(page("a", "x".repeat(10)));
    cache.put(page("b", "y".repeat(10)));
    cache.get("a");
    cache.put(page("c", "z".repeat(10)));

    expect(cache.list().map((entry) => entry.evidenceId)).toEqual(["a", "c"]);
  });

  it("evicts the least recently used page of any session over the total cap", () => {
    const store = new InMemoryPageCacheStore(limits);
    const first = store.forSession("one");
    const second = store.forSession("two");
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
