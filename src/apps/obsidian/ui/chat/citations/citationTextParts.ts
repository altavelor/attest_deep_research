// Pure splitting of a rendered text node into literal text and citation
// anchors. Kept free of the DOM so the token handling — which used to depend on
// where in the paragraph a token happened to sit — is directly testable.

import { stripRenderedCitationIds } from "./citationText";

const CITATION_TOKEN = /\[([^\]\n]{8,})\]/g;

export type CitationTextPart =
  | { kind: "text"; value: string }
  | { kind: "anchor"; chunkId: string };

/**
 * Returns the parts a text node should be replaced with, or `null` when it
 * carries no citation token and must be left untouched. Tokens that resolve to
 * a known source become anchors; unresolved ones are dropped regardless of their
 * position, so a paragraph starting with a stale handle no longer keeps it.
 */
export function splitCitationText(
  text: string,
  hasRef: (chunkId: string) => boolean,
): CitationTextPart[] | null {
  const parts: CitationTextPart[] = [];
  let lastIndex = 0;
  let matched = false;

  for (const match of text.matchAll(CITATION_TOKEN)) {
    if (match.index === undefined) continue;
    matched = true;
    if (match.index > lastIndex) {
      parts.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }
    if (hasRef(match[1]!)) {
      parts.push({ kind: "anchor", chunkId: match[1]! });
    }
    lastIndex = match.index + match[0].length;
  }

  if (!matched) return null;
  if (lastIndex < text.length) {
    parts.push({ kind: "text", value: stripRenderedCitationIds(text.slice(lastIndex)) });
  }
  return parts;
}

/** True when any part became an anchor; drives the fallback-anchor decision. */
export function countAnchors(parts: readonly CitationTextPart[]): number {
  return parts.filter((part) => part.kind === "anchor").length;
}
