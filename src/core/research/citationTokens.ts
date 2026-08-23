const CITATION_HANDLE_SOURCE = "[^\\]\\n\\s]{8,}";

/**
 * Shape of a rendered citation handle: a bracketed run of at least eight
 * non-space characters. Ordinary bracketed prose contains spaces and is left
 * alone, so `[Important note]` survives while a stale handle does not.
 */
export const CITATION_TOKEN_SOURCE = `\\[(${CITATION_HANDLE_SOURCE})\\]`;

const CITATION_HANDLE = new RegExp(`^${CITATION_HANDLE_SOURCE}$`);

export function isCitationHandle(token: string): boolean {
  return CITATION_HANDLE.test(token);
}

export interface MarkdownCodeRange {
  start: number;
  end: number;
}

/** Locates fenced and inline Markdown code so citation processing leaves examples unchanged. */
export function markdownCodeRanges(text: string): MarkdownCodeRange[] {
  const ranges = fencedCodeRanges(text);
  for (const match of text.matchAll(/(`+)(?!`)([^\n]*?)\1/gmu)) {
    const start = match.index ?? 0;
    if (!isMarkdownCodeIndex(start, ranges)) {
      ranges.push({ start, end: start + match[0].length });
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function fencedCodeRanges(text: string): MarkdownCodeRange[] {
  const ranges: MarkdownCodeRange[] = [];
  let open: { start: number; marker: "`" | "~"; length: number } | null = null;
  let lineStart = 0;

  while (lineStart < text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    if (!open) {
      const opener = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
      if (opener) {
        open = {
          start: lineStart,
          marker: opener[0] as "`" | "~",
          length: opener.length,
        };
      }
    } else if (isClosingFence(line, open.marker, open.length)) {
      ranges.push({ start: open.start, end: newline === -1 ? lineEnd : lineEnd + 1 });
      open = null;
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }

  if (open) ranges.push({ start: open.start, end: text.length });
  return ranges;
}

function isClosingFence(line: string, marker: "`" | "~", minimumLength: number): boolean {
  const candidate = line.match(/^ {0,3}(`+|~+)[ \t]*$/u)?.[1];
  return candidate !== undefined && candidate[0] === marker && candidate.length >= minimumLength;
}

export function isMarkdownCodeIndex(index: number, ranges: readonly MarkdownCodeRange[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}
