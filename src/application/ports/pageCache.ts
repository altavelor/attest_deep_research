export interface CachedPage {
  evidenceId: string;
  url: string;
  finalUrl: string;
  title: string;
  snippet: string;
  contentType: string;
  text: string;
  truncated: boolean;
}

/** The full text of the pages one agent session fetched, looked up by the evidence id of the page. */
export interface PageCache {
  readonly maxPageChars: number;
  put(page: CachedPage): void;
  get(evidenceId: string): CachedPage | undefined;
  list(): readonly CachedPage[];
}

/**
 * Owns the page caches of all agent sessions; a session never sees the pages of another. A retired
 * session loses its pages and stores no page again, so a fetch that was in flight cannot refill it.
 */
export interface PageCacheStore {
  forSession(sessionId: string): PageCache;
  release(sessionId: string): void;
  retire(sessionId: string): void;
  releaseAll(): void;
}
