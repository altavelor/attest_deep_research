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
const MAX_PROBE_REDIRECTS = 5;

const PROBE_CONCURRENCY = 4;

/**
 * Probe a batch of URLs, preserving input order. Runs with bounded concurrency so
 * a long list does not open dozens of sockets at once. Each entry fails/succeeds
 * independently — one bad URL never sinks the batch.
 */
export async function probeDocumentUrls(
  fetchImpl: typeof fetch,
  rawUrls: string[],
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<DocumentProbeResult[]> {
  const results = new Array<DocumentProbeResult>(rawUrls.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next; index < rawUrls.length; index = next) {
      next += 1;
      results[index] = await probeDocumentUrl(fetchImpl, rawUrls[index]!, timeoutMs);
    }
  };
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, rawUrls.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

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
    let { response, finalUrl } = await requestPublicUrl(fetchImpl, validated.url, {
      method: "HEAD",
      signal: controller.signal,
      headers: probeHeaders(),
    });
    if (response.status === 405 || response.status === 501) {
      ({ response, finalUrl } = await requestPublicUrl(fetchImpl, finalUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { ...probeHeaders(), Range: "bytes=0-0" },
      }));
      await response.body?.cancel().catch(() => undefined);
    }

    const contentType = normalizeContentType(response.headers.get("content-type"));
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

async function requestPublicUrl(
  fetchImpl: typeof fetch,
  initialUrl: string,
  init: RequestInit,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= MAX_PROBE_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(currentUrl, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) {
      const finalUrl = validatePublicWebUrl(response.url || currentUrl);
      if (!finalUrl.ok) {
        throw new Error("Unsafe final URL while probing a document.");
      }
      return { response, finalUrl: finalUrl.url };
    }

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirects === MAX_PROBE_REDIRECTS) {
      throw new Error("Unsafe or excessive redirect while probing a document URL.");
    }
    const redirected = validatePublicWebUrl(new URL(location, currentUrl).href);
    if (!redirected.ok) {
      throw new Error("Unsafe redirect while probing a document URL.");
    }
    currentUrl = redirected.url;
  }
  throw new Error("Excessive redirects while probing a document URL.");
}

function probeHeaders(): Record<string, string> {
  return {
    accept: "*/*",
    "user-agent": "Mozilla/5.0 (compatible; AttestDocumentProbe/1.0; +https://obsidian.md)",
  };
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
