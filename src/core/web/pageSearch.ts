export type PageSearchMode = "keywords" | "literal";

export interface PageMatch {
  offset: number;
  length: number;
  score: number;
}

export interface PageRange {
  offset: number;
  length: number;
  text: string;
  nextOffset: number | null;
  splitsToken?: true;
}

export interface PageOutlineEntry {
  offset: number;
  title: string;
}

export const MAX_PAGE_MATCHES = 200;
const MAX_HITS = 20_000;
const MAX_SNAP_CHARS = 100;
const MIN_TERM_CHARS = 2;
const MAX_OUTLINE_LINE_CHARS = 120;
const HEADING_WORDS =
  "article|section|chapter|annex|part|title|recital|artikel|kapitel|abschnitt|anhang|chapitre|annexe|art[ií]culo|cap[ií]tulo|secci[oó]n|anexo|статья|глава|раздел|приложение|часть";
const HEADING_LINE = new RegExp(
  `^(?:#{1,6}\\s+\\S|\\d+(?:\\.\\d+)*[.)]\\s+\\S|(?:${HEADING_WORDS})\\s+[0-9IVXLC]+\\b)`,
  "iu",
);

/** Splits a query into distinct lowercase terms of at least two letters or digits. */
export function pageSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const token of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= MIN_TERM_CHARS) seen.add(token);
  }
  return [...seen];
}

/**
 * Finds the passages of a text that match a query: non-overlapping windows around the hits of the
 * query terms, ranked by how many distinct terms they hold and how close those terms are. A literal
 * query matches the whole phrase and lists its occurrences in reading order. Offsets index the
 * original text.
 */
export function findInText(
  text: string,
  query: string,
  mode: PageSearchMode,
  context: number,
): PageMatch[] {
  const haystack = foldCase(text);
  const terms = mode === "literal" ? literalTerm(query) : pageSearchTerms(query);
  if (terms.length === 0) return [];
  const hits = collectHits(haystack, terms);
  if (hits.length === 0) return [];
  const candidates =
    mode === "literal"
      ? literalWindows(hits, terms[0]!, context, text)
      : windows(hits, terms, context, text);
  return selectNonOverlapping(candidates);
}

/**
 * Reads a range of a text with both edges moved to the nearest whitespace within a hundred
 * characters and never inside a surrogate pair; `nextOffset` is null at the end of the text. A word
 * longer than that window is cut where the range ends and `splitsToken` is set.
 */
export function readRange(text: string, offset: number, length: number): PageRange {
  const requested = Math.min(Math.max(0, offset), text.length);
  if (requested >= text.length)
    return { offset: text.length, length: 0, text: "", nextOffset: null };
  const start = snapStart(text, requested);
  const end = Math.max(start, snapEnd(text, Math.min(text.length, requested + length)));
  return {
    offset: start,
    length: end - start,
    text: text.slice(start, end),
    nextOffset: end < text.length ? end : null,
    ...(insideToken(text, start) || insideToken(text, end) ? { splitsToken: true as const } : {}),
  };
}

function insideToken(text: string, position: number): boolean {
  if (position <= 0 || position >= text.length) return false;
  return !/\s/u.test(text[position - 1]!) && !/\s/u.test(text[position]!);
}

/**
 * Lists the heading-like lines of a text in reading order: short lines that start with a markdown
 * marker, a number or a heading word. More candidates than `max` are thinned evenly across the text.
 */
export function pageOutline(text: string, max: number): PageOutlineEntry[] {
  const found: PageOutlineEntry[] = [];
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(offset, end).trim();
    if (line.length >= 3 && line.length <= MAX_OUTLINE_LINE_CHARS && HEADING_LINE.test(line)) {
      found.push({ offset, title: line });
    }
    offset = end + 1;
  }
  if (found.length <= max) return found;
  const step = found.length / max;
  return Array.from({ length: max }, (_, index) => found[Math.floor(index * step)]!);
}

interface Hit {
  position: number;
  term: number;
}

interface Candidate extends PageMatch {
  span: number;
}

function literalTerm(query: string): string[] {
  const phrase = query.toLowerCase().trim();
  return phrase.length >= MIN_TERM_CHARS ? [phrase] : [];
}

function foldCase(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  const chars = new Array<string>(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!.toLowerCase();
    chars[index] = char.length === 1 ? char : text[index]!;
  }
  return chars.join("");
}

function collectHits(haystack: string, terms: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  const perTerm = Math.max(1, Math.floor(MAX_HITS / terms.length));
  for (let term = 0; term < terms.length; term += 1) {
    let found = 0;
    let from = 0;
    while (found < perTerm) {
      const position = haystack.indexOf(terms[term]!, from);
      if (position === -1) break;
      hits.push({ position, term });
      found += 1;
      from = position + 1;
    }
  }
  return hits.sort((a, b) => a.position - b.position);
}

function windows(
  hits: readonly Hit[],
  terms: readonly string[],
  context: number,
  text: string,
): Candidate[] {
  const result: Candidate[] = [];
  const counts = new Array<number>(terms.length).fill(0);
  let distinct = 0;
  let tail = 0;
  for (let head = 0; head < hits.length; head += 1) {
    const anchor = hits[head]!;
    while (hits[tail]!.position < anchor.position - 2 * context) {
      const gone = hits[tail]!.term;
      counts[gone] = counts[gone]! - 1;
      if (counts[gone] === 0) distinct -= 1;
      tail += 1;
    }
    counts[anchor.term] = counts[anchor.term]! + 1;
    if (counts[anchor.term] === 1) distinct += 1;
    const first = hits[tail]!.position;
    const last = anchor.position + terms[anchor.term]!.length;
    result.push(passage(text, first, last, context, distinct, last - first));
  }
  return result;
}

function literalWindows(
  hits: readonly Hit[],
  phrase: string,
  context: number,
  text: string,
): Candidate[] {
  return hits.map((hit) =>
    passage(text, hit.position, hit.position + phrase.length, context, 1, hit.position),
  );
}

function passage(
  text: string,
  first: number,
  last: number,
  context: number,
  score: number,
  span: number,
): Candidate {
  const start = snapStart(text, Math.max(0, first - context));
  const end = snapEnd(text, Math.min(text.length, last + context));
  return { offset: start, length: end - start, score, span };
}

function selectNonOverlapping(candidates: Candidate[]): PageMatch[] {
  const ranked = [...candidates].sort(
    (a, b) => b.score - a.score || a.span - b.span || a.offset - b.offset,
  );
  const chosen: PageMatch[] = [];
  for (const candidate of ranked) {
    if (chosen.length >= MAX_PAGE_MATCHES) break;
    const end = candidate.offset + candidate.length;
    if (
      chosen.some((other) => candidate.offset < other.offset + other.length && other.offset < end)
    ) {
      continue;
    }
    chosen.push({ offset: candidate.offset, length: candidate.length, score: candidate.score });
  }
  return chosen;
}

function snapStart(text: string, position: number): number {
  if (position <= 0) return 0;
  for (let index = position; index >= Math.max(0, position - MAX_SNAP_CHARS); index -= 1) {
    if (index === 0 || /\s/u.test(text[index - 1]!) || /\s/u.test(text[index] ?? "")) {
      return avoidSplit(text, index);
    }
  }
  return avoidSplit(text, position);
}

function snapEnd(text: string, position: number): number {
  if (position >= text.length) return text.length;
  for (
    let index = position;
    index <= Math.min(text.length, position + MAX_SNAP_CHARS);
    index += 1
  ) {
    if (index === text.length || /\s/u.test(text[index]!)) return avoidSplit(text, index);
  }
  return avoidSplit(text, position);
}

function avoidSplit(text: string, position: number): number {
  const code = text.charCodeAt(position);
  return position > 0 && code >= 0xdc00 && code <= 0xdfff ? position - 1 : position;
}
