import {
  cleanSafeMarkupSource,
  parseSafeMarkup,
  type SafeBlock,
  type SafeInline,
  type SourceSpan,
} from "./safeInlineMarkup";

export const FOLD_ELLIPSIS = "…";

export interface FoldedSafeMarkup {
  blocks: SafeBlock[];
  folded: boolean;
}

const JOINING_MARK = new RegExp("^[\\p{M}\\u200d\\ufe00-\\ufe0f]$", "u");

/**
 * Cuts untrusted markup to a preview of at most limit characters and parses it. The cut
 * prefers a paragraph, line or word boundary, never splits a code point, a joined
 * grapheme or an inline construct, and the folded preview ends with an ellipsis.
 */
export function foldSafeMarkup(source: string, limit: number): FoldedSafeMarkup {
  const text = cleanSafeMarkupSource(source);
  if (text.length <= limit) return { blocks: parseSafeMarkup(text), folded: false };
  const spans: SourceSpan[] = [];
  parseSafeMarkup(text, spans);
  const cut = safeFoldPoint(text, limit, spans);
  const blocks = parseSafeMarkup(text.slice(0, cut).trimEnd());
  appendEllipsis(blocks);
  return { blocks, folded: true };
}

/** Returns the source index where a preview of at most limit characters may end. */
export function safeFoldPoint(text: string, limit: number, spans: readonly SourceSpan[]): number {
  const floor = Math.floor(limit / 2);
  let cut = boundaryBefore(text, limit, floor);
  while (cut > 0 && JOINING_MARK.test(text[cut] ?? "")) cut -= 1;
  if (cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
  if (cut > 0 && text[cut - 1] === "\u200d") cut -= 1;
  for (const span of spans) {
    if (span.start >= cut) break;
    if (span.end > cut) return span.start > 0 ? span.start : cut;
  }
  return cut;
}

function boundaryBefore(text: string, limit: number, floor: number): number {
  const paragraph = text.lastIndexOf("\n\n", limit);
  if (paragraph >= floor) return paragraph;
  const line = text.lastIndexOf("\n", limit);
  if (line >= floor) return line;
  for (let index = limit; index >= floor; index -= 1) {
    if (/\s/u.test(text[index] ?? "")) return index;
  }
  return limit;
}

function appendEllipsis(blocks: SafeBlock[]): void {
  const last = blocks.at(-1);
  if (!last) {
    blocks.push({ type: "paragraph", children: [{ type: "text", text: FOLD_ELLIPSIS }] });
    return;
  }
  const children: SafeInline[] = last.type === "list" ? last.items.at(-1)! : last.children;
  children.push({ type: "text", text: FOLD_ELLIPSIS });
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
