export interface MarkdownBracketMatch {
  index: number;
  end: number;
  labels: string[];
}

export type MarkdownBracketPattern = "label" | "reference" | "link" | "image";

const MAX_LABEL_CHARS = 200;
const MAX_LINK_TARGET_CHARS = 1000;

/**
 * Finds non-overlapping Markdown bracket constructs left to right, like a global regular
 * expression over single-line labels of bounded length. Precomputed stop positions keep
 * every scan linear in the text length, so newline-free bracket floods stay cheap.
 */
export function scanMarkdownBrackets(
  text: string,
  pattern: MarkdownBracketPattern,
): MarkdownBracketMatch[] {
  const stops = scanStops(text);
  const matches: MarkdownBracketMatch[] = [];
  let cursor = 0;
  for (let open = text.indexOf("[", cursor); open !== -1; open = text.indexOf("[", cursor)) {
    const bang = open > cursor && text[open - 1] === "!";
    const match = matchAt(text, stops, pattern, open, bang);
    if (match) {
      matches.push(match);
      cursor = match.end;
    } else {
      cursor = open + 1;
    }
  }
  return matches;
}

interface ScanStops {
  closeOrNewline: Int32Array;
  newline: Int32Array;
  lastParen: Int32Array;
}

function scanStops(text: string): ScanStops {
  const length = text.length;
  const closeOrNewline = new Int32Array(length + 1).fill(length);
  const newline = new Int32Array(length + 1).fill(length);
  const lastParen = new Int32Array(length + 1).fill(-1);
  for (let index = length - 1; index >= 0; index -= 1) {
    const char = text[index];
    newline[index] = char === "\n" ? index : newline[index + 1];
    closeOrNewline[index] = char === "]" || char === "\n" ? index : closeOrNewline[index + 1];
  }
  for (let index = 0; index < length; index += 1) {
    lastParen[index] = text[index] === ")" ? index : index > 0 ? lastParen[index - 1] : -1;
  }
  return { closeOrNewline, newline, lastParen };
}

function closingBracket(
  text: string,
  stops: ScanStops,
  open: number,
  minimum: number,
): number | null {
  const close = stops.closeOrNewline[open + 1];
  const size = close - open - 1;
  return text[close] === "]" && size >= minimum && size <= MAX_LABEL_CHARS ? close : null;
}

function matchAt(
  text: string,
  stops: ScanStops,
  pattern: MarkdownBracketPattern,
  open: number,
  bang: boolean,
): MarkdownBracketMatch | null {
  if (pattern === "image" && !bang) return null;
  const close = closingBracket(text, stops, open, pattern === "label" ? 1 : 0);
  if (close === null) return null;
  const index = bang && pattern !== "label" ? open - 1 : open;
  const label = text.slice(open + 1, close);
  if (pattern === "label" || pattern === "image") return { index, end: close + 1, labels: [label] };
  if (pattern === "reference") {
    if (text[close + 1] !== "[") return null;
    const second = closingBracket(text, stops, close + 1, 0);
    if (second === null) return null;
    return { index, end: second + 1, labels: [label, text.slice(close + 2, second)] };
  }
  if (text[close + 1] !== "(") return null;
  const targetStart = close + 2;
  const limit = Math.min(stops.newline[targetStart] - 1, targetStart + MAX_LINK_TARGET_CHARS);
  if (limit < targetStart) return null;
  const paren = stops.lastParen[Math.min(limit, text.length - 1)];
  return paren >= targetStart ? { index, end: paren + 1, labels: [label] } : null;
}
