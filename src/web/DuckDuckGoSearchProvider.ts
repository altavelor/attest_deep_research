import { IxplorerError } from "../shared/errors";
import { SearchProvider, SearchProviderResult, WebSearchOptions } from "../shared/types";
import type { PluginRequestLogger } from "../settings/debugLogger";
import { extractReadableText, parseDuckDuckGoResults } from "./DuckDuckGoParser";

export interface DuckDuckGoSearchProviderOptions {
  fetch?: typeof fetch;
  searchUrl?: string;
  timeoutMs?: number;
  maxExtractedTextLength?: number;
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

export class DuckDuckGoSearchProvider implements SearchProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly searchUrl: string;
  private readonly timeoutMs: number;
  private readonly maxExtractedTextLength: number;
  private readonly now: () => Date;
  private readonly logger?: PluginRequestLogger;

  constructor(options: DuckDuckGoSearchProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.searchUrl = options.searchUrl ?? DEFAULT_SEARCH_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxExtractedTextLength =
      options.maxExtractedTextLength ?? DEFAULT_MAX_EXTRACTED_TEXT_LENGTH;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<SearchProviderResult[]> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return [];
    }

    try {
      const limit = clampPositiveInteger(options.limit, DEFAULT_RESULT_LIMIT, HARD_RESULT_LIMIT);
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

  private async fetchSearchResults(query: string): Promise<string> {
    const url = new URL(this.searchUrl);
    url.searchParams.set("q", query);

    const response = await this.request(url.toString());

    if (!response.ok) {
      throw new IxplorerError({
        code: "WEB_SEARCH_FAILED",
        message: `DuckDuckGo returned HTTP ${response.status}.`,
        details: { status: response.status },
      });
    }

    return response.text();
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

  private async request(url: string): Promise<Response> {
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
  }
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
