import { IxplorerError } from "../shared/errors";
import { SearchProvider, SearchProviderResult } from "../shared/types";
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

  async searchFirstResult(query: string): Promise<SearchProviderResult | null> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return null;
    }

    try {
      const searchHtml = await this.fetchSearchResults(trimmedQuery);
      const firstResult = parseFirstDuckDuckGoResult(searchHtml);

      if (!firstResult) {
        return null;
      }

      const fetchedText = await this.fetchFirstResultText(firstResult.url);

      return {
        source: {
          id: `web:${firstResult.url}`,
          kind: "web",
          title: firstResult.title,
          url: firstResult.url,
          snippet: firstResult.snippet,
          retrievedAt: this.now().toISOString(),
          wasContentFetched: fetchedText !== undefined,
        },
        ...(fetchedText ? { extractedText: fetchedText } : {}),
      };
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

  private async fetchFirstResultText(url: string): Promise<string | undefined> {
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
      const response = await this.fetchImpl(url, {
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

function parseFirstDuckDuckGoResult(html: string): DuckDuckGoResult | null {
  const resultAnchor = parseAnchors(html).find((anchor) =>
    hasClass(anchor.attributes.class, "result__a"),
  );

  if (!resultAnchor) {
    return null;
  }

  const href = resultAnchor.attributes.href;
  const url = href ? decodeDuckDuckGoResultUrl(href) : "";
  if (!url || !isHttpUrl(url)) {
    return null;
  }

  return {
    url,
    title: normalizeWhitespace(stripHtml(resultAnchor.innerHtml)),
    snippet: parseResultSnippet(html),
  };
}

function parseResultSnippet(html: string): string {
  const snippetAnchor = parseAnchors(html).find((anchor) =>
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
