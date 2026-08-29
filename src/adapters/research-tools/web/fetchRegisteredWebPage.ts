import { SearchProvider } from "@application/ports";
import { validatePublicWebUrl } from "@application/sources";
import { EvidenceRegistry } from "@application/sources";
import { ToolExecution, toolFailure } from "@core/agent";
import type { ImageCandidate } from "@core/media";

export interface FetchWebPageOutput {
  resultId: string;
  evidenceId: string;
  url: string;
  finalUrl: string;
  content: string;
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

/**
 * Per-page download ceiling for a batch of `pageCount` parallel fetches. One page
 * may use the full budget; a large batch is trimmed so the bytes in flight stay
 * bounded regardless of how many pages the model requested at once.
 */
export function responseBytesForBatch(pageCount: number): number {
  const share = Math.floor(BATCH_RESPONSE_BYTES / Math.max(1, pageCount));
  return Math.min(DEFAULT_FETCH_OPTIONS.maxResponseBytes, Math.max(MIN_RESPONSE_BYTES, share));
}

export interface FetchRegisteredWebPageDeps {
  provider: SearchProvider;
  evidence: EvidenceRegistry;

  artifacts?: {
    register(candidates: readonly ImageCandidate[]): ReadonlyArray<{ handle: string }>;
  };
}

/**
 * Fetch and register the page behind a known resultId. `maxContentChars` lets
 * callers that re-rank long pages (fetch_web_section) pull more text than the
 * default head-truncation budget.
 */
export async function fetchRegisteredWebPage(
  deps: FetchRegisteredWebPageDeps,
  resultId: string,
  callId: string,
  maxContentChars: number = DEFAULT_FETCH_OPTIONS.maxContentChars,
  maxResponseBytes: number = DEFAULT_FETCH_OPTIONS.maxResponseBytes,
  signal?: AbortSignal,
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
      maxContentChars,
      maxResponseBytes,
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

  const content = result.content.slice(0, maxContentChars);
  const truncated = result.truncated || content.length < result.content.length;
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
      content,
      contentType: result.contentType,
      truncated,
      ...(imageIds.length > 0 ? { imageIds } : {}),
      untrustedEvidence: true,
    },
  };
}
