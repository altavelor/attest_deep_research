import { subAgentAliasOrdinal } from "@core/research";

export type SafeInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: SafeInline[] }
  | { type: "emphasis"; children: SafeInline[] }
  | { type: "code"; text: string }
  | { type: "evidence"; ordinal: number; token: string }
  | { type: "break" };

export type SafeBlock =
  | { type: "paragraph"; children: SafeInline[] }
  | { type: "heading"; children: SafeInline[] }
  | { type: "list"; ordered: boolean; start: number; items: SafeInline[][] };

export interface SourceSpan {
  start: number;
  end: number;
}

export const MAX_SAFE_MARKUP_CHARS = 128 * 1024;
const MAX_INLINE_DEPTH = 2;
const MAX_TOKEN_CHARS = 256;
const UNSAFE_CHARS = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u061c\\u200b\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff\\u{e0000}-\\u{e007f}]",
  "gu",
);
const WORD_CHAR = /[\p{L}\p{N}]/u;

interface LineStops {
  doubleStar: Int32Array;
  singleStar: Int32Array;
  underscore: Int32Array;
  backtick: Int32Array;
  bracket: Int32Array;
  paren: Int32Array;
}

interface InlineMatch {
  nodes: SafeInline[];
  next: number;
}

/** Removes control, bidirectional, invisible and tag characters from a single-line display text. */
export function cleanDisplayText(text: string): string {
  return text
    .replace(UNSAFE_CHARS, "")
    .replace(/[\n\r\t]+/gu, " ")
    .trim();
}

/**
 * Removes control and bidirectional override characters, normalizes line ends and caps
 * the text at a code-point boundary. Every parse and fold starts from this form.
 */
export function cleanSafeMarkupSource(source: string): string {
  const text = source.replace(/\r\n?/gu, "\n").replace(UNSAFE_CHARS, "");
  if (text.length <= MAX_SAFE_MARKUP_CHARS) return text;
  const cut = isHighSurrogate(text.charCodeAt(MAX_SAFE_MARKUP_CHARS - 1))
    ? MAX_SAFE_MARKUP_CHARS - 1
    : MAX_SAFE_MARKUP_CHARS;
  return text.slice(0, cut);
}

/**
 * Parses untrusted child text into a small typed tree: paragraphs, headings, lists, bold,
 * italic, inline code and inert sub-agent evidence tokens. Links and images keep only their
 * text, and every other construct or unbalanced marker stays literal. Lookups use
 * precomputed stop tables, so parsing is linear in the cleaned text length.
 */
export function parseSafeMarkup(source: string, spans?: SourceSpan[]): SafeBlock[] {
  const text = cleanSafeMarkupSource(source);
  const blocks: SafeBlock[] = [];
  let paragraph: SafeInline[] | null = null;
  let list: Extract<SafeBlock, { type: "list" }> | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineOffset = offset;
    offset += line.length + 1;
    if (line.trim().length === 0) {
      paragraph = null;
      list = null;
      continue;
    }
    const heading = headingStart(line);
    if (heading > 0) {
      blocks.push({ type: "heading", children: parseLine(line, heading, lineOffset, spans) });
      paragraph = null;
      list = null;
      continue;
    }
    const item = listItemStart(line);
    if (item) {
      if (!list || list.ordered !== item.ordered) {
        list = { type: "list", ordered: item.ordered, start: item.number, items: [] };
        blocks.push(list);
      }
      list.items.push(parseLine(line, item.content, lineOffset, spans));
      paragraph = null;
      continue;
    }
    list = null;
    const children = parseLine(line, 0, lineOffset, spans);
    if (paragraph) paragraph.push({ type: "break" }, ...children);
    else {
      paragraph = children;
      blocks.push({ type: "paragraph", children: paragraph });
    }
  }
  return blocks;
}

function headingStart(line: string): number {
  let index = leadingSpaces(line);
  const hashes = index;
  while (line[index] === "#" && index - hashes < 7) index += 1;
  const count = index - hashes;
  return count >= 1 && count <= 6 && isBlank(line[index]) ? index + 1 : 0;
}

function listItemStart(line: string): { ordered: boolean; number: number; content: number } | null {
  const index = leadingSpaces(line);
  const marker = line[index];
  if ((marker === "-" || marker === "*" || marker === "+") && isBlank(line[index + 1])) {
    return { ordered: false, number: 1, content: index + 2 };
  }
  let end = index;
  while (end - index < 9 && line[end]! >= "0" && line[end]! <= "9") end += 1;
  if (end === index || (line[end] !== "." && line[end] !== ")") || !isBlank(line[end + 1])) {
    return null;
  }
  return { ordered: true, number: Number(line.slice(index, end)), content: end + 2 };
}

function leadingSpaces(line: string): number {
  let index = 0;
  while (index < 3 && line[index] === " ") index += 1;
  return index;
}

function isBlank(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function parseLine(
  line: string,
  start: number,
  lineOffset: number,
  spans: SourceSpan[] | undefined,
): SafeInline[] {
  const parser = new InlineParser(line, lineOffset, spans);
  return parser.parse(Math.min(start, line.length), line.length, 0);
}

class InlineParser {
  private readonly stops: LineStops;

  constructor(
    private readonly line: string,
    private readonly lineOffset: number,
    private readonly spans: SourceSpan[] | undefined,
  ) {
    this.stops = lineStops(line);
  }

  parse(start: number, end: number, depth: number): SafeInline[] {
    const nodes: SafeInline[] = [];
    let textStart = start;
    let index = start;
    while (index < end) {
      const match = this.construct(index, end, depth);
      if (!match) {
        index += 1;
        continue;
      }
      pushText(nodes, this.line.slice(textStart, index));
      for (const node of match.nodes) {
        if (node.type === "text") pushText(nodes, node.text);
        else nodes.push(node);
      }
      if (depth === 0) {
        this.spans?.push({ start: this.lineOffset + index, end: this.lineOffset + match.next });
      }
      index = match.next;
      textStart = index;
    }
    pushText(nodes, this.line.slice(textStart, end));
    return nodes;
  }

  private construct(index: number, end: number, depth: number): InlineMatch | null {
    const { line, stops } = this;
    const char = line[index];
    if (char === "`") {
      const close = stops.backtick[index + 1]!;
      return close < end && close > index + 1
        ? { nodes: [{ type: "code", text: line.slice(index + 1, close) }], next: close + 1 }
        : null;
    }
    if (char === "*" && line[index + 1] === "*") {
      const close = stops.doubleStar[index + 2]!;
      if (depth >= MAX_INLINE_DEPTH || close >= end || close <= index + 2) return null;
      const children = this.parse(index + 2, close, depth + 1);
      return { nodes: [{ type: "strong", children }], next: close + 2 };
    }
    if (char === "*" || char === "_") return this.emphasis(index, end, depth);
    if (char === "!" && line[index + 1] === "[") {
      const link = this.link(index + 1, end);
      return link ? { nodes: link.nodes, next: link.next } : null;
    }
    if (char === "[") return this.link(index, end) ?? this.evidence(index, end);
    return null;
  }

  private emphasis(index: number, end: number, depth: number): InlineMatch | null {
    const { line, stops } = this;
    const star = line[index] === "*";
    if (star && line[index - 1] === "*") return null;
    if (!star && WORD_CHAR.test(line[index - 1] ?? "")) return null;
    const close = (star ? stops.singleStar : stops.underscore)[index + 1]!;
    if (depth >= MAX_INLINE_DEPTH || close >= end || close <= index + 1) return null;
    if (/\s/u.test(line[index + 1]!)) return null;
    const children = this.parse(index + 1, close, depth + 1);
    return { nodes: [{ type: "emphasis", children }], next: close + 1 };
  }

  private link(index: number, end: number): InlineMatch | null {
    const close = this.stops.bracket[index + 1]!;
    if (close >= end || this.line[close + 1] !== "(") return null;
    const paren = this.stops.paren[close + 2]!;
    if (paren >= end) return null;
    return {
      nodes: [{ type: "text", text: this.line.slice(index + 1, close) }],
      next: paren + 1,
    };
  }

  private evidence(index: number, end: number): InlineMatch | null {
    const close = this.stops.bracket[index + 1]!;
    if (close >= end || close - index > MAX_TOKEN_CHARS) return null;
    const token = this.line.slice(index + 1, close);
    const ordinal = subAgentAliasOrdinal(token);
    return ordinal === null
      ? null
      : { nodes: [{ type: "evidence", ordinal, token }], next: close + 1 };
  }
}

function lineStops(line: string): LineStops {
  const size = line.length + 2;
  const none = line.length + 1;
  const table = () => new Int32Array(size).fill(none);
  const stops: LineStops = {
    doubleStar: table(),
    singleStar: table(),
    underscore: table(),
    backtick: table(),
    bracket: table(),
    paren: table(),
  };
  for (let index = line.length - 1; index >= 0; index -= 1) {
    const char = line[index];
    const next = index + 1;
    stops.doubleStar[index] = char === "*" && line[next] === "*" ? index : stops.doubleStar[next]!;
    stops.singleStar[index] =
      char === "*" && line[next] !== "*" && line[index - 1] !== "*"
        ? index
        : stops.singleStar[next]!;
    stops.underscore[index] =
      char === "_" && !WORD_CHAR.test(line[next] ?? "") ? index : stops.underscore[next]!;
    stops.backtick[index] = char === "`" ? index : stops.backtick[next]!;
    stops.bracket[index] = char === "]" ? index : stops.bracket[next]!;
    stops.paren[index] = char === ")" ? index : stops.paren[next]!;
  }
  return stops;
}

function pushText(nodes: SafeInline[], text: string): void {
  if (text.length === 0) return;
  const last = nodes.at(-1);
  if (last?.type === "text") last.text += text;
  else nodes.push({ type: "text", text });
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
