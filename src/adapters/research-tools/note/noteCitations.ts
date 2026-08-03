import { Citation } from "@core/model";
import { SourceReference } from "@core/model";
import { validatePublicWebUrl } from "@application/sources/WebUrlPolicy";
import { linkifyUrlCitations } from "@application/use-cases/research";

export interface NoteCitationResult {
  content: string;
  count: number;
}

export function applyNoteCitations(
  content: string,
  citations: readonly Citation[],
  startNumber = 1,
): NoteCitationResult {
  if (!content) {
    return { content, count: 0 };
  }

  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  const byUrl = webCitationsByUrl(citations);
  const numberById = new Map<string, number>();
  const order: string[] = [];

  const assignFootnote = (id: string): string => {
    let assigned = numberById.get(id);
    if (assigned === undefined) {
      assigned = startNumber + order.length;
      order.push(id);
      numberById.set(id, assigned);
    }
    return `[^${assigned}]`;
  };

  const rewritten = content.replace(
    /\[([^\]\n]+)\]/g,
    (match, inner: string, offset: number, source: string) => {
      if (source[offset + match.length] === "(") {
        return match;
      }
      const token = inner.trim();
      if (token.startsWith("url:")) {
        const validated = validatePublicWebUrl(token.slice("url:".length).trim());
        if (!validated.ok) return match;
        const citation = byUrl.get(validated.url);
        return citation ? assignFootnote(citation.id) : match;
      }
      const citation = byId.get(token);
      return citation ? assignFootnote(citation.id) : match;
    },
  );

  const linked = linkifyUrlCitations(rewritten);

  if (order.length === 0) {
    return { content: linked, count: 0 };
  }

  const definitions = order
    .map((id) => {
      const citation = byId.get(id)!;
      return `[^${numberById.get(id)}]: ${footnoteLink(citation.source)}`;
    })
    .join("\n");

  const body = linked.replace(/\s+$/, "");
  return { content: `${body}\n\n${definitions}\n`, count: order.length };
}

/** Index web citations by their canonical URL, so `[url:…]` handles resolve to them. */
function webCitationsByUrl(citations: readonly Citation[]): Map<string, Citation> {
  const byUrl = new Map<string, Citation>();
  for (const citation of citations) {
    if (citation.source.kind !== "web") continue;
    const validated = validatePublicWebUrl(citation.source.url);
    if (validated.ok) byUrl.set(validated.url, citation);
  }
  return byUrl;
}

/** Highest footnote number already defined in the given text, or 0 when there are none. */
export function maxFootnoteNumber(text: string): number {
  let max = 0;
  for (const match of text.matchAll(/\[\^(\d+)\]/g)) {
    max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max;
}

function footnoteLink(source: SourceReference): string {
  switch (source.kind) {
    case "web":
      return `[${cleanLabel(source.title || source.url)}](${source.url})`;
    case "markdown": {
      const target = source.blockId ? `${source.path}#^${source.blockId}` : source.path;
      const heading = source.headingPath.length > 0 ? ` > ${source.headingPath.join(" > ")}` : "";
      return wikilink(target, `${source.title || source.path}${heading}`);
    }
    case "pdf":
      return wikilink(source.path, `${source.title || source.path} (p. ${source.pageNumber})`);
    case "document":
      return wikilink(source.path, source.title || source.path);
  }
}

function wikilink(target: string, label: string): string {
  return `[[${target}|${cleanLabel(label)}]]`;
}

function cleanLabel(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .replace(/[[\]|]/g, " ")
    .trim();
}
