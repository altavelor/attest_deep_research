export const PAGE_INLINE_CHARS = 8_000;
export const PAGE_HEAD_CHARS = 1_500;
export const PAGE_EVIDENCE_HEAD_CHARS = 2_000;
export const MAX_PAGE_EVIDENCE_CHARS = 16_000;
export const PAGE_OUTLINE_ENTRIES = 40;
export const BATCH_OUTPUT_CHARS = 16_000;
export const MAX_FIND_RESULT_CHARS = 6_000;
export const MAX_READ_RANGE_CHARS = 8_000;
export const MIN_READ_RANGE_CHARS = 200;
export const DEFAULT_READ_RANGE_CHARS = 4_000;
export const MAX_FIND_RESULT_IDS = 20;
export const MAX_FIND_LIMIT = 20;
export const DEFAULT_FIND_LIMIT = 8;
export const MIN_FIND_CONTEXT = 80;
export const MAX_FIND_CONTEXT = 1_000;
export const DEFAULT_FIND_CONTEXT = 250;

export interface PageCacheLimits {
  maxPageChars: number;
  maxSessionChars: number;
  maxTotalChars: number;
}

export const DEFAULT_PAGE_CACHE_LIMITS: Readonly<PageCacheLimits> = Object.freeze({
  maxPageChars: 4_000_000,
  maxSessionChars: 16_000_000,
  maxTotalChars: 48_000_000,
});

const MOBILE_FACTOR = 0.25;

/** Returns the page cache limits for the platform: a quarter of the desktop caps on mobile. */
export function pageCacheLimits(mobile: boolean): PageCacheLimits {
  if (!mobile) return { ...DEFAULT_PAGE_CACHE_LIMITS };
  return {
    maxPageChars: DEFAULT_PAGE_CACHE_LIMITS.maxPageChars * MOBILE_FACTOR,
    maxSessionChars: DEFAULT_PAGE_CACHE_LIMITS.maxSessionChars * MOBILE_FACTOR,
    maxTotalChars: DEFAULT_PAGE_CACHE_LIMITS.maxTotalChars * MOBILE_FACTOR,
  };
}
