import { IxplorerError } from "@core/errors";
import {
  SearchProvider,
  SearchProviderResult,
  WebPageFetchOptions,
  WebPageFetchFailure,
  WebPageFetchResult,
  WebPageMetadataResult,
  WebSearchOptions,
} from "@application/ports";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { extractPageMetadata, extractReadableText, parseDuckDuckGoResults } from "./DuckDuckGoParser";
import { validatePublicWebUrl } from "@application/sources";

export interface DuckDuckGoSearchProviderOptions {
  fetch?: typeof fetch;
  searchUrl?: string;
  timeoutMs?: number;
  maxExtractedTextLength?: number;
  /** Result count used when a per-call `limit` is not supplied (user setting). */
  defaultResultLimit?: number;
  /** Minimum spacing between outbound requests, to avoid DuckDuckGo rate limits. */
  minRequestIntervalMs?: number;
  /** Retries on a rate-limited search response before failing. */
  maxSearchRetries?: number;
  /** Base backoff between rate-limit retries (multiplied by attempt number). */
  rateLimitBackoffMs?: number;
  now?: () => Date;
  logger?: PluginRequestLogger;
}

const DEFAULT_SEARCH_URL = "https://html.duckduckgo.com/html/";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_EXTRACTED_TEXT_LENGTH = 12_000;
const DEFAULT_RESULT_LIMIT = 5;
const DEFAULT_MAX_FETCHES = 3;
const HARD_RESULT_LIMIT = 50;
const HARD_MAX_FETCHES = 15;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_MAX_REDIRECTS = 5;
// DuckDuckGo's HTML endpoint blocks bursts aggressively. Agents (including deep
// research sub-agents sharing this instance) can fan out many queries at once, so
// outbound requests are serialized and spaced, with bounded backoff on 429/503.
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 700;
const DEFAULT_MAX_SEARCH_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 1_500;

export class DuckDuckGoSearchProvider implements SearchProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly searchUrl: string;
  private readonly timeoutMs: number;
  private readonly maxExtractedTextLength: number;
  private readonly defaultResultLimit: number;
  private readonly minRequestIntervalMs: number;
  private readonly maxSearchRetries: number;
  private readonly rateLimitBackoffMs: number;
  private readonly now: () => Date;
  private readonly logger?: PluginRequestLogger;
  // Serializes + spaces all outbound requests across concurrent callers.
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: DuckDuckGoSearchProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.searchUrl = options.searchUrl ?? DEFAULT_SEARCH_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxExtractedTextLength =
      options.maxExtractedTextLength ?? DEFAULT_MAX_EXTRACTED_TEXT_LENGTH;
    this.defaultResultLimit = clampPositiveInteger(
      options.defaultResultLimit,
      DEFAULT_RESULT_LIMIT,
      HARD_RESULT_LIMIT,
    );
    this.minRequestIntervalMs = Math.max(0, options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS);
    this.maxSearchRetries = Math.max(0, options.maxSearchRetries ?? DEFAULT_MAX_SEARCH_RETRIES);
    this.rateLimitBackoffMs = Math.max(0, options.rateLimitBackoffMs ?? RATE_LIMIT_BACKOFF_MS);
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
  }

  /** Run an outbound request after the chain drains and the min interval elapses. */
  private gate<T>(task: () => Promise<T>): Promise<T> {
    const result = this.requestChain.then(async () => {
      const wait = this.minRequestIntervalMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await delay(wait);
      this.lastRequestAt = Date.now();
      return task();
    });
    this.requestChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<SearchProviderResult[]> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return [];
    }

    try {
      const limit = clampPositiveInteger(options.limit, this.defaultResultLimit, HARD_RESULT_LIMIT);
      const maxFetches = clampNonNegativeInteger(
        options.maxFetches,
        DEFAULT_MAX_FETCHES,
        HARD_MAX_FETCHES,
      );
      const searchHtml = await this.fetchSearchResults(trimmedQuery);
      const results = parseDuckDuckGoResults(searchHtml).slice(0, limit);

      return Promise.all(
        results.map(async (result, index) => {
          const fetchedText =
            index < maxFetches ? await this.fetchResultText(result.url) : undefined;

          return {
            source: {
              id: `web:${result.url}`,
              kind: "web",
              title: result.title,
              url: result.url,
              snippet: result.snippet,
              retrievedAt: this.now().toISOString(),
              wasContentFetched: fetchedText !== undefined,
            },
            ...(fetchedText ? { extractedText: fetchedText } : {}),
            rank: index + 1,
            query: trimmedQuery,
          };
        }),
      );
    } catch (error) {
      if (error instanceof IxplorerError) {
        this.logger?.logError(error);
        throw error;
      }

      const wrappedError = new IxplorerError({
        code: "WEB_SEARCH_FAILED",
        message: "DuckDuckGo search failed.",
        cause: error,
      });
      this.logger?.logError(wrappedError);
      throw wrappedError;
    }
  }

  async fetchPage(url: string, options: WebPageFetchOptions = {}): Promise<WebPageFetchResult> {
    const raw = await this.fetchRawPage(url, options);
    if (!raw.ok) {
      return raw.result;
    }

    const maxContentChars = positiveInteger(options.maxContentChars, this.maxExtractedTextLength);
    const extracted =
      raw.contentType === "text/plain"
        ? raw.rawText.replace(/\s+/g, " ").trim()
        : extractReadableText(raw.rawText, maxContentChars + 1);
    if (!extracted) {
      return pageFailure("web-fetch-empty-content", "Page contained no readable text.", false);
    }
    const content = extracted.slice(0, maxContentChars);

    return {
      ok: true,
      url: raw.url,
      finalUrl: raw.finalUrl,
      content,
      contentType: raw.contentType,
      bytes: raw.byteLength,
      truncated: extracted.length > maxContentChars,
      redirects: raw.redirects,
    };
  }

  async fetchMetadata(url: string, options: WebPageFetchOptions = {}): Promise<WebPageMetadataResult> {
    const raw = await this.fetchRawPage(url, options);
    if (!raw.ok) {
      return raw.result;
    }
    if (raw.contentType === "text/plain") {
      return { ok: true, url: raw.url, finalUrl: raw.finalUrl, metadata: {} };
    }
    return {
      ok: true,
      url: raw.url,
      finalUrl: raw.finalUrl,
      metadata: extractPageMetadata(raw.rawText),
    };
  }

  /** Shared fetch core for fetchPage/fetchMetadata: follows redirects, reads bounded HTML. */
  private async fetchRawPage(
    url: string,
    options: WebPageFetchOptions,
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

    const timeoutMs = positiveInteger(options.timeoutMs, this.timeoutMs);
    const maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    const maxRedirects = nonNegativeInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS);
    const redirects: string[] = [];
    let currentUrl = initial.url;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      let response: Response;
      try {
        response = await this.requestPage(currentUrl, timeoutMs);
      } catch (error) {
        if (isAbortError(error)) {
          return { ok: false, result: pageFailure("web-fetch-timeout", "Page fetch timed out.", true) };
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
      if (!isSupportedPageContentType(contentType)) {
        return {
          ok: false,
          result: pageFailure("web-fetch-content-type", "Page content type is not supported.", false, {
            contentType,
          }),
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
        contentType,
        byteLength: body.bytes.byteLength,
        redirects,
      };
    }

    return {
      ok: false,
      result: pageFailure("web-fetch-redirect", "Page exceeded the redirect limit.", false),
    };
  }

  private async fetchSearchResults(query: string): Promise<string> {
    const url = new URL(this.searchUrl);
    url.searchParams.set("q", query);

    for (let attempt = 0; ; attempt += 1) {
      const response = await this.request(url.toString());

      if (response.ok) {
        return response.text();
      }

      if (isRateLimited(response.status) && attempt < this.maxSearchRetries) {
        await response.body?.cancel().catch(() => undefined);
        await delay(this.rateLimitBackoffMs * (attempt + 1));
        continue;
      }

      throw new IxplorerError({
        code: "WEB_SEARCH_FAILED",
        message: `DuckDuckGo returned HTTP ${response.status}.`,
        details: { status: response.status },
      });
    }
  }

  private async fetchResultText(url: string): Promise<string | undefined> {
    let response: Response;

    try {
      response = await this.request(url);
    } catch {
      return undefined;
    }

    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("text/html")) {
      return undefined;
    }

    const text = extractReadableText(await response.text(), this.maxExtractedTextLength);
    return text.length > 0 ? text : undefined;
  }

  private request(url: string): Promise<Response> {
    return this.gate(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const context = {
        url,
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml",
        },
      };

      try {
        this.logger?.logRequest(context);
        const response = await this.fetchImpl.call(globalThis, url, {
          method: "GET",
          headers: context.headers,
          signal: controller.signal,
        });
        this.logger?.logResponse({
          ...context,
          status: response.status,
          statusText: response.statusText,
        });
        return response;
      } catch (error) {
        this.logger?.logError(error, context);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private requestPage(url: string, timeoutMs: number): Promise<Response> {
    return this.gate(() => this.requestPageNow(url, timeoutMs));
  }

  private async requestPageNow(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const context = {
      url,
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml,text/plain" },
    };

    try {
      this.logger?.logRequest(context);
      const response = await this.fetchImpl.call(globalThis, url, {
        method: "GET",
        headers: context.headers,
        redirect: "manual",
        signal: controller.signal,
      });
      this.logger?.logResponse({
        ...context,
        status: response.status,
        statusText: response.statusText,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

type RawPageResult =
  | {
      ok: true;
      url: string;
      finalUrl: string;
      rawText: string;
      contentType: string;
      byteLength: number;
      redirects: string[];
    }
  | { ok: false; result: WebPageFetchFailure };

function clampPositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), max));
}

function clampNonNegativeInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(Math.floor(value), max));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(status: number): boolean {
  return status === 429 || status === 503 || status === 202;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function normalizedContentType(value: string | null): string {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isSupportedPageContentType(contentType: string): boolean {
  return (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "text/plain"
  );
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; result: WebPageFetchFailure }> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
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

  if (!response.body) {
    return { ok: true, bytes: new Uint8Array() };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
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

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
