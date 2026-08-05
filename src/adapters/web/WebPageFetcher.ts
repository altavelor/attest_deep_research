import { validatePublicWebUrl } from "@application/sources";
import { WebPageFetchFailure, WebPageFetchOptions } from "@application/ports";
import { HostRequestThrottle } from "./HostRequestThrottle";

const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_MAX_REDIRECTS = 5;

export type RawPageResult =
  | {
      ok: true;
      url: string;
      finalUrl: string;
      rawText: string;
      bytes: Uint8Array;
      contentType: string;
      contentDisposition?: string;
      byteLength: number;
      redirects: string[];
    }
  | { ok: false; result: WebPageFetchFailure };

export interface WebPageFetcherOptions {
  requestPage: (url: string, timeoutMs: number, signal?: AbortSignal) => Promise<Response>;
  throttle: HostRequestThrottle;
  defaultTimeoutMs: number;
}

/** Safely retrieves one web page, including redirect validation and bounded response reading. */
export class WebPageFetcher {
  private readonly requestPage: (
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<Response>;
  private readonly throttle: HostRequestThrottle;
  private readonly defaultTimeoutMs: number;

  constructor(options: WebPageFetcherOptions) {
    this.requestPage = options.requestPage;
    this.throttle = options.throttle;
    this.defaultTimeoutMs = options.defaultTimeoutMs;
  }

  fetch(
    url: string,
    options: WebPageFetchOptions,
    acceptContentType: (contentType: string) => boolean = isSupportedPageContentType,
  ): Promise<RawPageResult> {
    return this.throttle.run(hostOf(url), () => this.fetchNow(url, options, acceptContentType));
  }

  private async fetchNow(
    url: string,
    options: WebPageFetchOptions,
    acceptContentType: (contentType: string) => boolean,
  ): Promise<RawPageResult> {
    const initial = validatePublicWebUrl(url);
    if (!initial.ok) {
      return {
        ok: false,
        result: pageFailure("unsafe-web-url", "The registered web URL is not allowed.", false, {
          reason: initial.reason,
        }),
      };
    }

    const timeoutMs = positiveInteger(options.timeoutMs, this.defaultTimeoutMs);
    const maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    const maxRedirects = nonNegativeInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS);
    const redirects: string[] = [];
    let currentUrl = initial.url;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      let response: Response;
      try {
        response = await this.requestPage(currentUrl, timeoutMs, options.signal);
      } catch (error) {
        if (isAbortError(error)) {
          return {
            ok: false,
            result: pageFailure("web-fetch-timeout", "Page fetch timed out.", true),
          };
        }
        return { ok: false, result: pageFailure("web-fetch-network", "Page fetch failed.", true) };
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          return {
            ok: false,
            result: pageFailure("web-fetch-redirect", "Redirect response had no location.", false),
          };
        }
        if (redirectCount === maxRedirects) {
          return {
            ok: false,
            result: pageFailure("web-fetch-redirect", "Page exceeded the redirect limit.", false),
          };
        }
        const redirected = validatePublicWebUrl(new URL(location, currentUrl).toString());
        if (!redirected.ok) {
          return {
            ok: false,
            result: pageFailure("web-fetch-redirect", "Redirect target is not allowed.", false, {
              reason: redirected.reason,
            }),
          };
        }
        currentUrl = redirected.url;
        redirects.push(currentUrl);
        continue;
      }

      if (!response.ok) {
        return {
          ok: false,
          result: pageFailure(
            "web-fetch-http",
            `Page fetch returned HTTP ${response.status}.`,
            response.status === 429 || response.status >= 500,
            { status: response.status },
          ),
        };
      }

      const contentType = normalizedContentType(response.headers.get("content-type"));
      if (!acceptContentType(contentType)) {
        return {
          ok: false,
          result: pageFailure(
            "web-fetch-content-type",
            "Page content type is not supported.",
            false,
            { contentType },
          ),
        };
      }

      let body: Awaited<ReturnType<typeof readBoundedBody>>;
      try {
        body = await readBoundedBody(response, maxResponseBytes);
      } catch {
        return {
          ok: false,
          result: pageFailure("web-fetch-network", "Page response could not be read.", true),
        };
      }
      if (!body.ok) {
        return { ok: false, result: body.result };
      }

      return {
        ok: true,
        url: initial.url,
        finalUrl: currentUrl,
        rawText: new TextDecoder().decode(body.bytes),
        bytes: body.bytes,
        contentType,
        contentDisposition: response.headers.get("content-disposition") ?? undefined,
        byteLength: body.bytes.byteLength,
        redirects,
      };
    }

    return {
      ok: false,
      result: pageFailure("web-fetch-redirect", "Page exceeded the redirect limit.", false),
    };
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function normalizedContentType(value: string | null): string {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; result: WebPageFetchFailure }> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return Promise.resolve({
      ok: false,
      result: pageFailure(
        "web-fetch-response-too-large",
        "Page response exceeded the size limit.",
        false,
        { maxBytes },
      ),
    });
  }

  return readResponseStream(response, maxBytes);
}

async function readResponseStream(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; result: WebPageFetchFailure }> {
  if (!response.body) {
    return { ok: true, bytes: new Uint8Array() };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return {
        ok: false,
        result: pageFailure(
          "web-fetch-response-too-large",
          "Page response exceeded the size limit.",
          false,
          { maxBytes },
        ),
      };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function pageFailure(
  code: string,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): WebPageFetchFailure {
  return {
    ok: false,
    error: { code, message, retryable, ...(details ? { details } : {}) },
  };
}

function isSupportedPageContentType(contentType: string): boolean {
  return (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "text/plain"
  );
}

export function isDocumentContentType(contentType: string): boolean {
  return DOCUMENT_CONTENT_TYPES.has(contentType);
}

const DOCUMENT_CONTENT_TYPES = new Set<string>([
  "application/pdf",
  "application/x-pdf",
  "application/epub+zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/plain",
  "application/octet-stream",
]);
