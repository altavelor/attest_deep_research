import { IxplorerError } from "../shared/errors";
import { SearchProvider, SearchProviderResult, WebSearchOptions } from "../shared/types";
import type { PluginRequestLogger } from "../settings/debugLogger";

export interface DuckDuckGoSearchProviderOptions {
  fetch?: typeof fetch;
  searchUrl?: string;
  timeoutMs?: number;
  maxExtractedTextLength?: number;
  now?: () => Date;
  logger?: PluginRequestLogger;
}

interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

interface HtmlAnchor {
  attributes: Record<string, string>;
  innerHtml: string;
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

function parseDuckDuckGoResults(html: string): DuckDuckGoResult[] {
  const blockResults = parseResultBlocks(html)
    .map((block) => parseDuckDuckGoResultBlock(block))
    .filter((result): result is DuckDuckGoResult => result !== null);

  return blockResults.length > 0 ? blockResults : parseLegacyDuckDuckGoResults(html);
}

function parseDuckDuckGoResultBlock(html: string): DuckDuckGoResult | null {
  const anchors = parseAnchors(html);
  const resultAnchor = anchors.find((anchor) => hasClass(anchor.attributes.class, "result__a"));

  if (!resultAnchor) {
    return null;
  }

  return resultFromAnchor(resultAnchor, anchors);
}

function parseLegacyDuckDuckGoResults(html: string): DuckDuckGoResult[] {
  const anchors = parseAnchors(html);

  return anchors
    .filter((anchor) => hasClass(anchor.attributes.class, "result__a"))
    .map((anchor, index) => resultFromAnchor(anchor, anchors.slice(index + 1)))
    .filter((result): result is DuckDuckGoResult => result !== null);
}

function resultFromAnchor(
  resultAnchor: HtmlAnchor,
  snippetAnchors: HtmlAnchor[],
): DuckDuckGoResult | null {
  const href = resultAnchor.attributes.href;
  const url = href ? decodeDuckDuckGoResultUrl(href) : "";
  if (!url || !isHttpUrl(url)) {
    return null;
  }

  return {
    url,
    title: normalizeWhitespace(stripHtml(resultAnchor.innerHtml)),
    snippet: parseResultSnippet(snippetAnchors),
  };
}

function parseResultBlocks(html: string): string[] {
  const blocks: string[] = [];
  const blockPattern =
    /<div\b[^>]*class=(["'])[^"']*\bresult\b[^"']*\1[^>]*>[\s\S]*?(?=<div\b[^>]*class=(["'])[^"']*\bresult\b[^"']*\2|<\/body>|<\/html>|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(html)) !== null) {
    blocks.push(match[0]);
  }

  return blocks;
}

function parseResultSnippet(anchors: HtmlAnchor[]): string {
  const snippetAnchor = anchors.find((anchor) =>
    hasClass(anchor.attributes.class, "result__snippet"),
  );

  return snippetAnchor ? normalizeWhitespace(stripHtml(snippetAnchor.innerHtml)) : "";
}

function decodeDuckDuckGoResultUrl(href: string): string {
  const normalizedHref = href.startsWith("//") ? `https:${href}` : href;

  try {
    const url = new URL(normalizedHref);
    const redirectedUrl = url.searchParams.get("uddg");
    return redirectedUrl ? decodeURIComponent(redirectedUrl) : url.toString();
  } catch {
    return "";
  }
}

function extractReadableText(html: string, maxLength: number): string {
  const withoutIgnoredContent = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");

  return normalizeWhitespace(stripHtml(withoutIgnoredContent)).slice(0, maxLength);
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, codepoint: string) =>
      String.fromCodePoint(Number.parseInt(codepoint, 16)),
    )
    .replace(/&#(\d+);/g, (_, codepoint: string) =>
      String.fromCodePoint(Number.parseInt(codepoint, 10)),
    );
}

function parseAnchors(html: string): HtmlAnchor[] {
  const anchors: HtmlAnchor[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    anchors.push({
      attributes: parseAttributes(match[1]),
      innerHtml: match[2],
    });
  }

  return anchors;
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([a-zA-Z:-]+)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(value)) !== null) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[3]);
  }

  return attributes;
}

function hasClass(className: string | undefined, expectedClass: string): boolean {
  return className?.split(/\s+/).includes(expectedClass) ?? false;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
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
