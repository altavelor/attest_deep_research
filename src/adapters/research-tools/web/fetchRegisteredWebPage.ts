import type { PageCache, SearchProvider } from "@application/ports";
import { validatePublicWebUrl } from "@application/sources";
import { EvidenceRegistry } from "@application/sources";
import { ToolExecution, toolFailure } from "@core/agent";
import type { ImageCandidate } from "@core/media";
import {
  DEFAULT_PAGE_CACHE_LIMITS,
  PAGE_EVIDENCE_HEAD_CHARS,
  PAGE_HEAD_CHARS,
  PAGE_INLINE_CHARS,
  PAGE_OUTLINE_ENTRIES,
  pageOutline,
  type PageOutlineEntry,
} from "@core/web";

export interface FetchWebPageOutput {
  resultId: string;
  evidenceId: string;
  url: string;
  finalUrl: string;
  content?: string;
  totalChars: number;
  head?: string;
  outline?: PageOutlineEntry[];
  hint?: string;
  contentType: string;
  truncated: boolean;

  imageIds?: string[];
  untrustedEvidence: true;
}

export const DEFAULT_FETCH_OPTIONS = {
  timeoutMs: 30_000,
  maxResponseBytes: 4_194_304,
  maxContentChars: 16_000,
  maxRedirects: 5,
} as const;

const MIN_RESPONSE_BYTES = 1_048_576;

const BATCH_RESPONSE_BYTES = 10_485_760;
const CACHED_RESPONSE_BYTES = 16_777_216;
const CACHED_BATCH_RESPONSE_BYTES = 33_554_432;
const METADATA_CHARS = 200;
const LARGE_PAGE_HINT = "Large page: use find_in_pages and read_page_range to read it.";

/**
 * Per-page download ceiling for a batch of `pageCount` parallel fetches. One page
 * may use the full budget; a large batch is trimmed so the bytes in flight stay
 * bounded regardless of how many pages the model requested at once.
 */
export function responseBytesForBatch(pageCount: number, cached = false): number {
  const share = Math.floor(
    (cached ? CACHED_BATCH_RESPONSE_BYTES : BATCH_RESPONSE_BYTES) / Math.max(1, pageCount),
  );
  return Math.min(
    cached ? CACHED_RESPONSE_BYTES : DEFAULT_FETCH_OPTIONS.maxResponseBytes,
    Math.max(MIN_RESPONSE_BYTES, share),
  );
}

export interface FetchRegisteredWebPageDeps {
  provider: SearchProvider;
  evidence: EvidenceRegistry;
  pageCache?: PageCache;

  artifacts?: {
    register(candidates: readonly ImageCandidate[]): ReadonlyArray<{ handle: string }>;
  };
}

/**
 * Fetch and register the page behind a known resultId. With a page cache the whole page is stored
 * there and a page longer than the inline threshold returns only its size, outline and head; an
 * explicit `maxContentChars` (fetch_web_section) always returns that much of the text instead. An
 * `outputBudget` bounds the serialized result of this page: a page that does not fit it inline is
 * answered with a shortened head and outline.
 */
export async function fetchRegisteredWebPage(
  deps: FetchRegisteredWebPageDeps,
  resultId: string,
  callId: string,
  maxContentChars?: number,
  maxResponseBytes?: number,
  signal?: AbortSignal,
  outputBudget?: number,
): Promise<ToolExecution<FetchWebPageOutput>> {
  if (signal?.aborted) {
    return toolFailure("web-fetch-cancelled", "Page fetch was cancelled.", false);
  }
  const registered = deps.evidence.resolveWebResult(resultId);
  if (!registered) {
    return toolFailure("unknown-web-result", "The web result is not registered for this answer.");
  }
  const safeUrl = validatePublicWebUrl(registered.canonicalUrl);
  if (!safeUrl.ok) {
    return toolFailure("unsafe-web-url", "The registered web URL is not allowed.");
  }
  if (!deps.provider.fetchPage) {
    return toolFailure("web-fetch-unsupported", "The web provider cannot fetch pages.");
  }

  let result;
  try {
    result = await deps.provider.fetchPage(safeUrl.url, {
      ...DEFAULT_FETCH_OPTIONS,
      maxContentChars: deps.pageCache
        ? DEFAULT_PAGE_CACHE_LIMITS.maxPageChars
        : (maxContentChars ?? DEFAULT_FETCH_OPTIONS.maxContentChars),
      maxResponseBytes: maxResponseBytes ?? responseBytesForBatch(1, deps.pageCache !== undefined),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return signal?.aborted
      ? toolFailure("web-fetch-cancelled", "Page fetch was cancelled.", false)
      : toolFailure("web-fetch-failed", "Page fetch failed.", true);
  }
  if (signal?.aborted) {
    return toolFailure("web-fetch-cancelled", "Page fetch was cancelled.", false);
  }
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
    return toolFailure("web-fetch-invalid-response", "Page fetch returned an invalid response.");
  }
  if (!result.ok) {
    return result;
  }
  const finalUrl = validatePublicWebUrl(result.finalUrl);
  if (
    !finalUrl.ok ||
    typeof result.content !== "string" ||
    typeof result.contentType !== "string" ||
    typeof result.truncated !== "boolean"
  ) {
    return toolFailure("web-fetch-invalid-response", "Page fetch returned unsafe metadata.");
  }

  const imageIds =
    deps.artifacts && Array.isArray(result.pageImages)
      ? deps.artifacts.register(result.pageImages).map((entry) => entry.handle)
      : [];

  const cap = maxContentChars ?? DEFAULT_FETCH_OPTIONS.maxContentChars;
  const totalChars = result.content.length;
  deps.pageCache?.put({
    evidenceId: registered.evidenceId,
    url: registered.canonicalUrl,
    finalUrl: finalUrl.url,
    title: registered.source.title,
    snippet: registered.source.snippet,
    contentType: result.contentType,
    text: result.content,
    truncated: result.truncated,
  });
  const metadataChars = METADATA_CHARS + registered.canonicalUrl.length + finalUrl.url.length;
  const room =
    outputBudget === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, outputBudget - metadataChars);
  const compact =
    deps.pageCache !== undefined &&
    maxContentChars === undefined &&
    totalChars > Math.min(PAGE_INLINE_CHARS, room);
  const content = result.content.slice(0, compact ? PAGE_EVIDENCE_HEAD_CHARS : cap);
  const truncated = result.truncated || (!compact && content.length < totalChars);
  deps.evidence.upgradeWebPage(resultId, {
    content,
    finalUrl: finalUrl.url,
    truncated,
    callId,
  });

  return {
    ok: true,
    value: {
      resultId,
      evidenceId: registered.evidenceId,
      url: registered.canonicalUrl,
      finalUrl: finalUrl.url,
      totalChars,
      ...(compact ? compactView(result.content, room) : { content }),
      contentType: result.contentType,
      truncated,
      ...(imageIds.length > 0 ? { imageIds } : {}),
      untrustedEvidence: true,
    },
  };
}

/**
 * Builds the head, outline and hint of a page too large to return whole, shortened until their
 * serialized size fits the room left for the page.
 */
function compactView(
  text: string,
  room: number,
): Pick<FetchWebPageOutput, "head" | "outline" | "hint"> {
  const hintChars = LARGE_PAGE_HINT.length + 40;
  const head = text.slice(0, Math.min(PAGE_HEAD_CHARS, Math.max(0, Math.floor(room / 3))));
  const outline = pageOutline(text, PAGE_OUTLINE_ENTRIES);
  while (outline.length > 0 && JSON.stringify(outline).length + head.length + hintChars > room) {
    outline.pop();
  }
  return { head, outline, hint: LARGE_PAGE_HINT };
}
