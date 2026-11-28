import type { CachedPage, PageCache, PageCacheStore } from "@application/ports";
import { DEFAULT_PAGE_CACHE_LIMITS, type PageCacheLimits } from "@core/web";

interface Slot {
  page: CachedPage;
  lastUse: number;
}

/**
 * Keeps the fetched pages of each agent session in memory. A page longer than the per-page cap is
 * cut and flagged, and whole least-recently-used pages leave when a session or the store exceeds
 * its cap; the page just stored always stays. Nothing is persisted.
 */
export class InMemoryPageCacheStore implements PageCacheStore {
  private readonly sessions = new Map<string, Map<string, Slot>>();
  private readonly retired = new Set<string>();
  private tick = 0;

  constructor(private readonly limits: PageCacheLimits = DEFAULT_PAGE_CACHE_LIMITS) {}

  forSession(sessionId: string): PageCache {
    return {
      put: (page) => this.put(sessionId, page),
      get: (evidenceId) => this.touch(this.sessions.get(sessionId)?.get(evidenceId)),
      list: () => [...(this.sessions.get(sessionId)?.values() ?? [])].map((slot) => slot.page),
    };
  }

  release(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  retire(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.retired.add(sessionId);
  }

  releaseAll(): void {
    this.sessions.clear();
    this.retired.clear();
  }

  private put(sessionId: string, page: CachedPage): void {
    if (this.retired.has(sessionId)) return;
    const text = page.text.slice(0, this.limits.maxPageChars);
    const stored: CachedPage = {
      ...page,
      text,
      truncated: page.truncated || text.length < page.text.length,
    };
    const session = this.sessions.get(sessionId) ?? new Map<string, Slot>();
    this.sessions.set(sessionId, session);
    const kept: Slot = { page: stored, lastUse: this.next() };
    session.set(page.evidenceId, kept);
    this.evict(
      () => sizeOf(session) > this.limits.maxSessionChars,
      [...session.entries()].map(([id, slot]) => ({ session, id, slot })),
      kept,
    );
    this.evict(
      () => this.total() > this.limits.maxTotalChars,
      [...this.sessions.values()].flatMap((owned) =>
        [...owned.entries()].map(([id, slot]) => ({ session: owned, id, slot })),
      ),
      kept,
    );
  }

  private evict(
    over: () => boolean,
    candidates: { session: Map<string, Slot>; id: string; slot: Slot }[],
    keep: Slot,
  ): void {
    const order = candidates
      .filter((candidate) => candidate.slot !== keep)
      .sort((a, b) => a.slot.lastUse - b.slot.lastUse);
    for (const candidate of order) {
      if (!over()) return;
      candidate.session.delete(candidate.id);
    }
  }

  private touch(slot: Slot | undefined): CachedPage | undefined {
    if (!slot) return undefined;
    slot.lastUse = this.next();
    return slot.page;
  }

  private total(): number {
    let total = 0;
    for (const session of this.sessions.values()) total += sizeOf(session);
    return total;
  }

  private next(): number {
    this.tick += 1;
    return this.tick;
  }
}

function sizeOf(session: Map<string, Slot>): number {
  let size = 0;
  for (const slot of session.values()) size += slot.page.text.length;
  return size;
}
