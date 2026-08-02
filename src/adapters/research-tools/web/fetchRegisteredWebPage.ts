// Shared page-fetch core for the web-fetch tools (fetch_web_page / fetch_url /
// fetch_web_section). Given a resultId already registered in the evidence
// registry, it validates the URL, fetches bounded text through the provider,
// upgrades the evidence entry, and returns the normalized fetch output. The tools
// differ only in how the resultId is obtained and how the content is post-shaped.

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
  untrustedEvidence: true;
}

export const DEFAULT_FETCH_OPTIONS = {
  timeoutMs: 30_000,
  maxResponseBytes: 1_048_576,
  maxContentChars: 16_000,
  maxRedirects: 5,
} as const;

export interface FetchRegisteredWebPageDeps {
  provider: SearchProvider;
  evidence: EvidenceRegistry;
  /** Collects page-referenced image candidates for present_image_gallery. */
  artifacts?: { register(candidates: readonly ImageCandidate[]): unknown };
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
): Promise<ToolExecution<FetchWebPageOutput>> {
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
    });
  } catch {
    return toolFailure("web-fetch-failed", "Page fetch failed.", true);
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

  if (deps.artifacts && Array.isArray(result.pageImages)) {
    deps.artifacts.register(result.pageImages);
  }

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
      untrustedEvidence: true,
    },
  };
}
