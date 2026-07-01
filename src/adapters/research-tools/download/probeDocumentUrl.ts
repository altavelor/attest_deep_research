// HEAD probe for the `probe_document_url` tool: reports whether a URL points at
// a downloadable document (content-type/size/filename) without transferring the
// body. Self-contained (its own bounded fetch) so it does not widen the
// SearchProvider port with a probe-only method.

import { validatePublicWebUrl } from "@application/sources";
import {
  deriveFilename,
  isDownloadableContentType,
  normalizeContentType,
} from "./documentDownload";

export interface DocumentProbeResult {
  ok: boolean;
  url: string;
  finalUrl?: string;
  downloadable: boolean;
  contentType?: string;
  sizeBytes?: number;
  suggestedFilename?: string;
  status?: number;
  reason?: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 15_000;

export async function probeDocumentUrl(
  fetchImpl: typeof fetch,
  rawUrl: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<DocumentProbeResult> {
  const validated = validatePublicWebUrl(rawUrl);
  if (!validated.ok) {
    return { ok: false, url: rawUrl, downloadable: false, reason: validated.reason };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetchImpl.call(globalThis, validated.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: probeHeaders(),
    });
    // Some servers reject HEAD (405/501) — fall back to a range-limited GET.
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl.call(globalThis, validated.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { ...probeHeaders(), Range: "bytes=0-0" },
      });
      await response.body?.cancel().catch(() => undefined);
    }

    const contentType = normalizeContentType(response.headers.get("content-type"));
    const finalUrl = response.url || validated.url;
    const sizeBytes = parseContentLength(response.headers.get("content-length"));
    const downloadable = response.ok && isDownloadableContentType(contentType);

    return {
      ok: response.ok,
      url: validated.url,
      finalUrl,
      downloadable,
      contentType: contentType || undefined,
      sizeBytes,
      suggestedFilename: deriveFilename(
        finalUrl,
        response.headers.get("content-disposition"),
        contentType,
      ),
      status: response.status,
      ...(response.ok ? {} : { reason: `http-${response.status}` }),
    };
  } catch (error) {
    return {
      ok: false,
      url: validated.url,
      downloadable: false,
      reason: error instanceof Error ? error.name : "fetch-failed",
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function probeHeaders(): Record<string, string> {
  return {
    accept: "*/*",
    "user-agent": "Mozilla/5.0 (compatible; IxplorerDocumentProbe/1.0; +https://obsidian.md)",
  };
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
