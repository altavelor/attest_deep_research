import type {
  CachedPage,
  ChatPageCaches,
  OwnedPageCache,
  PageCacheStore,
} from "@application/ports";
import { DEFAULT_PAGE_CACHE_LIMITS, type PageCacheLimits } from "@core/web";

interface Slot {
  page: CachedPage;
  lastUse: number;
}

interface Leaf {
  slots: Map<string, Slot>;
  closed: boolean;
  owner: Set<Leaf>;
}

/**
 * Keeps the fetched pages of every chat in memory, one leaf per run or agent session. A page longer
 * than the per-page cap is cut and flagged, and whole least-recently-used pages leave when a leaf or
 * the whole store exceeds its cap; the page just stored always stays. Nothing is persisted.
 */
export class InMemoryPageCacheStore implements PageCacheStore {
  private readonly leaves = new Set<Leaf>();
  private tick = 0;

  constructor(private readonly limits: PageCacheLimits = DEFAULT_PAGE_CACHE_LIMITS) {}

  createChat(): ChatPageCaches {
    const own = new Set<Leaf>();
    const sessions = new Map<string, Leaf>();
    const stopped = new Set<string>();
    let closed = false;
    const open = (refused: boolean): Leaf => {
      const leaf: Leaf = { slots: new Map(), closed: refused || closed, owner: own };
      if (!leaf.closed) {
        own.add(leaf);
        this.leaves.add(leaf);
      }
      return leaf;
    };
    return {
      openRun: () => this.cacheOf(open(false)),
      openSession: (sessionId) => {
        const leaf = sessions.get(sessionId) ?? open(stopped.has(sessionId));
        sessions.set(sessionId, leaf);
        return this.cacheOf(leaf);
      },
      sessionPages: (sessionId) => {
        const leaf = sessions.get(sessionId);
        return leaf && !leaf.closed ? this.cacheOf(leaf) : undefined;
      },
      closeSession: (sessionId) => {
        stopped.add(sessionId);
        const leaf = sessions.get(sessionId);
        if (leaf) this.drop(leaf);
      },
      close: () => {
        closed = true;
        for (const leaf of [...own]) this.drop(leaf);
        sessions.clear();
      },
    };
  }

  private cacheOf(leaf: Leaf): OwnedPageCache {
    return {
      maxPageChars: this.limits.maxPageChars,
      put: (page) => this.put(leaf, page),
      get: (evidenceId) => this.touch(leaf.slots.get(evidenceId)),
      list: () => [...leaf.slots.values()].map((slot) => slot.page),
      close: () => this.drop(leaf),
    };
  }

  private drop(leaf: Leaf): void {
    leaf.closed = true;
    leaf.slots.clear();
    leaf.owner.delete(leaf);
    this.leaves.delete(leaf);
  }

  private put(leaf: Leaf, page: CachedPage): void {
    if (leaf.closed) return;
    const text = page.text.slice(0, this.limits.maxPageChars);
    const stored: CachedPage = {
      ...page,
      text,
      truncated: page.truncated || text.length < page.text.length,
    };
    const kept: Slot = { page: stored, lastUse: this.next() };
    leaf.slots.set(page.evidenceId, kept);
    this.evict(
      () => sizeOf(leaf.slots) > this.limits.maxSessionChars,
      [...leaf.slots.entries()].map(([id, slot]) => ({ slots: leaf.slots, id, slot })),
      kept,
    );
    this.evict(
      () => this.total() > this.limits.maxTotalChars,
      [...this.leaves].flatMap((owned) =>
        [...owned.slots.entries()].map(([id, slot]) => ({ slots: owned.slots, id, slot })),
      ),
      kept,
    );
  }

  private evict(
    over: () => boolean,
    candidates: { slots: Map<string, Slot>; id: string; slot: Slot }[],
    keep: Slot,
  ): void {
    const order = candidates
      .filter((candidate) => candidate.slot !== keep)
      .sort((a, b) => a.slot.lastUse - b.slot.lastUse);
    for (const candidate of order) {
      if (!over()) return;
      candidate.slots.delete(candidate.id);
    }
  }

  private touch(slot: Slot | undefined): CachedPage | undefined {
    if (!slot) return undefined;
    slot.lastUse = this.next();
    return slot.page;
  }

  private total(): number {
    let total = 0;
    for (const leaf of this.leaves) total += sizeOf(leaf.slots);
    return total;
  }

  private next(): number {
    this.tick += 1;
    return this.tick;
  }
}

function sizeOf(slots: Map<string, Slot>): number {
  let size = 0;
  for (const slot of slots.values()) size += slot.page.text.length;
  return size;
}
