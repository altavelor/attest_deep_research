export interface CachedPage {
  evidenceId: string;
  url: string;
  finalUrl: string;
  title: string;
  snippet: string;
  contentType: string;
  text: string;
  truncated: boolean;
  version: string;
}

/** The full text of the pages one agent session fetched, looked up by the evidence id of the page. */
export interface PageCache {
  readonly maxPageChars: number;
  put(page: CachedPage): void;
  get(evidenceId: string): CachedPage | undefined;
  list(): readonly CachedPage[];
}

/** The pages one agent session or run holds; closing it drops them and refuses every later page. */
export interface OwnedPageCache extends PageCache {
  close(): void;
}

/**
 * The page caches of one chat. A run or an agent session owns its cache and sees no other; the chat
 * can read the pages of an agent session, and closing a session or the chat releases its pages.
 */
export interface ChatPageCaches {
  openRun(): OwnedPageCache;
  openSession(sessionId: string): OwnedPageCache;
  sessionPages(sessionId: string): Pick<PageCache, "get" | "list"> | undefined;
  closeSession(sessionId: string): void;
  close(): void;
}

/** Creates the page caches of a chat; all chats of a plugin share one memory budget. */
export interface PageCacheStore {
  createChat(): ChatPageCaches;
}
