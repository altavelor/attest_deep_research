import { AttestError } from "@core/errors";
import {
  SearchProvider,
  SearchProviderResult,
  WebPageFetchOptions,
  WebPageFetchResult,
  WebPageMetadataResult,
  WebDocumentFetchResult,
  WebSearchOptions,
} from "@application/ports";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import {
  extractPageMetadata,
  extractReadableText,
  isDuckDuckGoChallengePage,
  parseDuckDuckGoResults,
} from "./DuckDuckGoParser";
import { HostRequestThrottle } from "./HostRequestThrottle";
import { extractPageImages } from "./images/pageImages";
import { isDocumentContentType, WebPageFetcher } from "./WebPageFetcher";

export interface DuckDuckGoSearchProviderOptions {
  fetch?: typeof fetch;
  searchUrl?: string;
  timeoutMs?: number;
  maxExtractedTextLength?: number;

  defaultResultLimit?: number;

  minRequestIntervalMs?: number;

  maxSearchRetries?: number;

  rateLimitBackoffMs?: number;

  pageFetchIntervalMs?: number;

  pageFetchConcurrency?: number;
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

const DEFAULT_MIN_REQUEST_INTERVAL_MS = 700;
const DEFAULT_MAX_SEARCH_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 1_500;

const DEFAULT_PAGE_FETCH_INTERVAL_MS = 250;
const DEFAULT_PAGE_FETCH_CONCURRENCY = 6;

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
  private requestChain: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly pageFetcher: WebPageFetcher;

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
    this.minRequestIntervalMs = Math.max(
      0,
      options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS,
    );
    this.maxSearchRetries = Math.max(0, options.maxSearchRetries ?? DEFAULT_MAX_SEARCH_RETRIES);
    this.rateLimitBackoffMs = Math.max(0, options.rateLimitBackoffMs ?? RATE_LIMIT_BACKOFF_MS);
    const pageThrottle = new HostRequestThrottle({
      perHostIntervalMs: options.pageFetchIntervalMs ?? DEFAULT_PAGE_FETCH_INTERVAL_MS,
      maxConcurrent: options.pageFetchConcurrency ?? DEFAULT_PAGE_FETCH_CONCURRENCY,
    });
    this.pageFetcher = new WebPageFetcher({
      requestPage: (url, timeoutMs, signal) => this.requestPage(url, timeoutMs, signal),
      throttle: pageThrottle,
      defaultTimeoutMs: this.timeoutMs,
    });
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
      const searchHtml = await this.fetchSearchResults(trimmedQuery, options.signal);
      const results = parseDuckDuckGoResults(searchHtml).slice(0, limit);

      return Promise.all(
        results.map(async (result, index) => {
          const fetchedText =
            index < maxFetches ? await this.fetchResultText(result.url, options.signal) : undefined;

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
      if (error instanceof AttestError) {
        this.logger?.logError(error);
        throw error;
      }

      const wrappedError = new AttestError({
        code: "WEB_SEARCH_FAILED",
        message: "DuckDuckGo search failed.",
        cause: error,
      });
      this.logger?.logError(wrappedError);
      throw wrappedError;
    }
  }

  async fetchPage(url: string, options: WebPageFetchOptions = {}): Promise<WebPageFetchResult> {
    const raw = await this.pageFetcher.fetch(url, options);
    if (!raw.ok) {
      return raw.result;
    }

    const maxContentChars = positiveInteger(options.maxContentChars, this.maxExtractedTextLength);
    const extracted =
      raw.contentType === "text/plain"
        ? raw.rawText.replace(/\s+/g, " ").trim()
        : extractReadableText(raw.rawText, maxContentChars + 1);
    if (!extracted) {
      return {
        ok: false,
        error: {
          code: "web-fetch-empty-content",
          message: "Page contained no readable text.",
          retryable: false,
        },
      };
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
      ...(raw.contentType === "text/plain"
        ? {}
        : { pageImages: extractPageImages({ html: raw.rawText, baseUrl: raw.finalUrl }) }),
    };
  }

  async fetchMetadata(
    url: string,
    options: WebPageFetchOptions = {},
  ): Promise<WebPageMetadataResult> {
    const raw = await this.pageFetcher.fetch(url, options);
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

  async fetchDocument(
    url: string,
    options: WebPageFetchOptions = {},
  ): Promise<WebDocumentFetchResult> {
    const raw = await this.pageFetcher.fetch(url, options, isDocumentContentType);
    if (!raw.ok) {
      return raw.result;
    }
    return {
      ok: true,
      url: raw.url,
      finalUrl: raw.finalUrl,
      data: raw.bytes,
      contentType: raw.contentType,
      ...(raw.contentDisposition ? { contentDisposition: raw.contentDisposition } : {}),
      bytes: raw.byteLength,
      redirects: raw.redirects,
    };
  }

  private async fetchSearchResults(query: string, signal?: AbortSignal): Promise<string> {
    const url = new URL(this.searchUrl);
    url.searchParams.set("q", query);

    for (let attempt = 0; ; attempt += 1) {
      const response = await this.request(url.toString(), signal);

      if (response.ok) {
        const html = await response.text();
        if (isDuckDuckGoChallengePage(html)) {
          throw new AttestError({
            code: "WEB_SEARCH_FAILED",
            message:
              "DuckDuckGo served an anti-bot challenge instead of results. Enable another web source or retry later.",
            details: { sourceId: "duckduckgo", reason: "blocked", status: response.status },
          });
        }
        return html;
      }

      if (isRateLimited(response.status) && attempt < this.maxSearchRetries) {
        await response.body?.cancel().catch(() => undefined);
        await delay(this.rateLimitBackoffMs * (attempt + 1));
        continue;
      }

      throw new AttestError({
        code: "WEB_SEARCH_FAILED",
        message: `DuckDuckGo returned HTTP ${response.status}.`,
        details: { status: response.status },
      });
    }
  }

  /**
   * Result pages go through the per-host throttle rather than the DuckDuckGo
   * request gate, so they load in parallel instead of queueing behind the
   * search interval. A failed page is skipped silently, as before.
   */
  private async fetchResultText(url: string, signal?: AbortSignal): Promise<string | undefined> {
    let raw: Awaited<ReturnType<WebPageFetcher["fetch"]>>;

    try {
      raw = await this.pageFetcher.fetch(url, signal ? { signal } : {}, isSearchResultContentType);
    } catch {
      return undefined;
    }

    if (!raw.ok) {
      return undefined;
    }

    const text = extractReadableText(raw.rawText, this.maxExtractedTextLength);
    return text.length > 0 ? text : undefined;
  }

  private request(url: string, signal?: AbortSignal): Promise<Response> {
    return this.gate(async () => {
      const abort = linkAbortSignal(this.timeoutMs, signal);
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
          signal: abort.signal,
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
        abort.release();
      }
    });
  }

  private requestPage(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    return this.requestPageNow(url, timeoutMs, signal);
  }

  private async requestPageNow(
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const abort = linkAbortSignal(timeoutMs, signal);
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
        signal: abort.signal,
      });
      this.logger?.logResponse({
        ...context,
        status: response.status,
        statusText: response.statusText,
      });
      return response;
    } finally {
      abort.release();
    }
  }
}

/**
 * Abort an outbound request when its timeout elapses or when the caller
 * abandons the turn. `release` clears the timer and the caller subscription.
 */
function linkAbortSignal(
  timeoutMs: number,
  external: AbortSignal | undefined,
): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, timeoutMs);

  if (external?.aborted === true) {
    abort();
  } else {
    external?.addEventListener("abort", abort);
  }

  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timeout);
      external?.removeEventListener("abort", abort);
    },
  };
}

function isSearchResultContentType(contentType: string): boolean {
  return contentType === "" || contentType === "text/html";
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(status: number): boolean {
  return status === 429 || status === 503 || status === 202;
}
