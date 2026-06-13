import { normalizeInlineWhitespace } from "../shared/whitespace";

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

export function extractReadableText(html: string, maxLength: number): string {
  const withoutIgnoredContent = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");

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
