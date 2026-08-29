import { validatePublicWebUrl } from "@application/sources";
import { WebPageFetchFailure, WebPageFetchOptions } from "@application/ports";
import { HostRequestThrottle } from "./HostRequestThrottle";

const DEFAULT_MAX_RESPONSE_BYTES = 4_194_304;
const DEFAULT_MAX_REDIRECTS = 5;

export type RawPageResult =
  | {
      ok: true;
      url: string;
      finalUrl: string;
      rawText: string;
      bytes: Uint8Array;
      truncated: boolean;
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

  /**
   * Retrieves one page. `allowTruncation` opts into stopping at the byte ceiling
   * and reporting `truncated`; callers that need the whole byte stream, such as
   * document downloads, must leave it off so an oversized response still fails.
   */
  fetch(
    url: string,
    options: WebPageFetchOptions,
    acceptContentType: (contentType: string) => boolean = isSupportedPageContentType,
    allowTruncation = false,
  ): Promise<RawPageResult> {
    return this.throttle.run(hostOf(url), () =>
      this.fetchNow(url, options, acceptContentType, allowTruncation),
    );
  }

  private async fetchNow(
    url: string,
    options: WebPageFetchOptions,
    acceptContentType: (contentType: string) => boolean,
    allowTruncation: boolean,
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
        body = await readBoundedBody(response, maxResponseBytes, allowTruncation);
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
        rawText: decodeUtf8(body.bytes, body.truncated),
        bytes: body.bytes,
        truncated: body.truncated,
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
  allowTruncation: boolean,
): Promise<BoundedBodyResult> {
  if (!allowTruncation) {
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
  }

  return readResponseStream(response, maxBytes, allowTruncation);
}

/**
 * Reads the body up to `maxBytes`. Text pages stop at the limit and report
 * `truncated`, so a long article still yields its leading content; other types
 * keep failing, because a partial binary document cannot be parsed.
 */
async function readResponseStream(
  response: Response,
  maxBytes: number,
  allowTruncation: boolean,
): Promise<BoundedBodyResult> {
  if (!response.body) {
    return { ok: true, bytes: new Uint8Array(), truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      if (!allowTruncation) {
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
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      total = maxBytes;
      truncated = true;
      break;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes, truncated };
}

/**
 * Decodes UTF-8 bytes, dropping a trailing multi-byte sequence that truncation
 * cut in half so the text does not end in a replacement character.
 */
function decodeUtf8(bytes: Uint8Array, truncated: boolean): string {
  if (!truncated) return new TextDecoder().decode(bytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const text = decoder.decode(bytes, { stream: true });
  return text;
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

type BoundedBodyResult =
  { ok: true; bytes: Uint8Array; truncated: boolean } | { ok: false; result: WebPageFetchFailure };

export function isSupportedPageContentType(contentType: string): boolean {
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
