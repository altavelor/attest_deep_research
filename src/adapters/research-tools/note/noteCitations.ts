import { Citation } from "../../../core/model/citation";
import { SourceReference } from "../../../core/model/source";

export interface NoteCitationResult {
  /** Content with citation IDs replaced by footnote markers and a reference list appended. */
  content: string;
  /** Number of distinct citations that were linked. */
  count: number;
}

/**
 * Rewrites raw evidence-ID citation tokens (e.g. `[web:2ae0…]`) inside note content
 * into Obsidian footnote markers (`[^1]`) and appends matching footnote definitions
 * that link to the underlying source — a web URL (opens in the browser) or a vault
 * wikilink (opens the local document inside Obsidian).
 *
 * Only bracketed tokens whose inner text exactly matches a known citation ID are
 * rewritten, so ordinary prose and markdown links are left untouched. When no known
 * citation IDs appear, the content is returned unchanged.
 *
 * @param startNumber First footnote number to assign. Use a value past any footnotes
 * already present in the target file to avoid collisions when appending/prepending.
 */
export function applyNoteCitations(
  content: string,
  citations: readonly Citation[],
  startNumber = 1,
): NoteCitationResult {
  if (!content || citations.length === 0) {
    return { content, count: 0 };
  }

  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  const numberById = new Map<string, number>();
  const order: string[] = [];

  const rewritten = content.replace(
    /\[([^\]\n]+)\]/g,
    (match, inner: string, offset: number, source: string) => {
      // Leave markdown links `[label](target)` intact.
      if (source[offset + match.length] === "(") {
        return match;
      }
      const id = inner.trim();
      const citation = byId.get(id);
      if (!citation) {
        return match;
      }
      let assigned = numberById.get(id);
      if (assigned === undefined) {
        assigned = startNumber + order.length;
        order.push(id);
        numberById.set(id, assigned);
      }
      return `[^${assigned}]`;
    },
  );

  if (order.length === 0) {
    return { content, count: 0 };
  }

  const definitions = order
    .map((id) => {
      const citation = byId.get(id)!;
      return `[^${numberById.get(id)}]: ${footnoteLink(citation.source)}`;
    })
    .join("\n");

  const body = rewritten.replace(/\s+$/, "");
  return { content: `${body}\n\n${definitions}\n`, count: order.length };
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
      const heading =
        source.headingPath.length > 0 ? ` > ${source.headingPath.join(" > ")}` : "";
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
  return label.replace(/\s+/g, " ").replace(/[[\]|]/g, " ").trim();
}
