import { normalizeInlineWhitespace } from "@shared";

export interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

interface HtmlAnchor {
  attributes: Record<string, string>;
  innerHtml: string;
}

export function parseDuckDuckGoResults(html: string): DuckDuckGoResult[] {
  const blockResults = parseResultBlocks(html)
    .map((block) => parseDuckDuckGoResultBlock(block))
    .filter((result): result is DuckDuckGoResult => result !== null);

  return blockResults.length > 0 ? blockResults : parseLegacyDuckDuckGoResults(html);
}

const CHALLENGE_MARKERS = [/\banomaly\.js\b/i, /\banomaly-modal\b/i, /\bdeep_dark_challenge\b/i];

/**
 * Detect the DuckDuckGo anti-bot interstitial that is served instead of the
 * result list. Such a page parses to zero results, which is indistinguishable
 * from an empty query unless the caller recognises the challenge markers.
 */
export function isDuckDuckGoChallengePage(html: string): boolean {
  return CHALLENGE_MARKERS.some((marker) => marker.test(html));
}

export interface PageMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  author?: string;
  publishedTime?: string;
  language?: string;
  canonicalUrl?: string;
}

/** Parse lightweight head metadata (title / Open Graph / author / published) from raw HTML. */
export function extractPageMetadata(html: string): PageMetadata {
  const head = html.split(/<\/head>/i, 1)[0] ?? html;
  const metas = parseMetaTags(head);

  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = metas.get(key);
      if (value) return value;
    }
    return undefined;
  };

  const metadata: PageMetadata = {
    title: pick("og:title", "twitter:title") ?? parseTitleTag(head),
    description: pick("og:description", "twitter:description", "description"),
    siteName: pick("og:site_name", "application-name"),
    author: pick("author", "article:author"),
    publishedTime: pick("article:published_time", "datepublished", "date"),
    language: parseHtmlLang(html),
    canonicalUrl: parseCanonicalLink(head) ?? pick("og:url"),
  };

  for (const key of Object.keys(metadata) as (keyof PageMetadata)[]) {
    if (!metadata[key]) delete metadata[key];
  }
  return metadata;
}

function parseMetaTags(html: string): Map<string, string> {
  const metas = new Map<string, string>();
  const pattern = /<meta\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const attributes = parseAttributes(match[1]);
    const key = (attributes.property ?? attributes.name ?? attributes.itemprop)?.toLowerCase();
    const content = attributes.content;
    if (key && content && !metas.has(key)) {
      metas.set(key, normalizeInlineWhitespace(content));
    }
  }
  return metas;
}

function parseTitleTag(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return undefined;
  const title = normalizeInlineWhitespace(stripHtml(match[1]));
  return title.length > 0 ? title : undefined;
}

function parseHtmlLang(html: string): string | undefined {
  const match = /<html\b[^>]*\blang\s*=\s*(["'])(.*?)\1/i.exec(html);
  const lang = match ? normalizeInlineWhitespace(match[2]) : "";
  return lang.length > 0 ? lang : undefined;
}

function parseCanonicalLink(html: string): string | undefined {
  const pattern = /<link\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const attributes = parseAttributes(match[1]);
    if (attributes.rel?.toLowerCase() === "canonical" && attributes.href) {
      const href = attributes.href.trim();
      if (href.length > 0) return href;
    }
  }
  return undefined;
}

export function extractReadableText(html: string, maxLength: number): string {
  const withoutIgnoredContent = html
    .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, " ")
    .replace(/<style\b[\s\S]*?(?:<\/style\s*>|$)/gi, " ")
    .replace(/<noscript\b[\s\S]*?(?:<\/noscript\s*>|$)/gi, " ")
    .replace(/<svg\b[\s\S]*?(?:<\/svg\s*>|$)/gi, " ")
    .replace(/<nav\b[\s\S]*?(?:<\/nav\s*>|$)/gi, " ")
    .replace(/<header\b[\s\S]*?(?:<\/header\s*>|$)/gi, " ")
    .replace(/<footer\b[\s\S]*?(?:<\/footer\s*>|$)/gi, " ")
    .replace(/<aside\b[\s\S]*?(?:<\/aside\s*>|$)/gi, " ");

  return normalizeInlineWhitespace(stripHtml(withoutIgnoredContent)).slice(0, maxLength);
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
    title: normalizeInlineWhitespace(stripHtml(resultAnchor.innerHtml)),
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

  return snippetAnchor ? normalizeInlineWhitespace(stripHtml(snippetAnchor.innerHtml)) : "";
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

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39|#x([0-9a-f]+)|#(\d+));/gi,
    (entity, hex: string | undefined, decimal: string | undefined) => {
      if (hex !== undefined) return safeFromCodePoint(Number.parseInt(hex, 16), entity);
      if (decimal !== undefined) return safeFromCodePoint(Number.parseInt(decimal, 10), entity);
      return NAMED_ENTITIES[entity.toLowerCase()] ?? entity;
    },
  );
}

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function safeFromCodePoint(codepoint: number, fallback: string): string {
  if (!Number.isFinite(codepoint) || codepoint < 0 || codepoint > 0x10ffff) return fallback;
  return String.fromCodePoint(codepoint);
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
