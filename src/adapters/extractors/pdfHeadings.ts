// PDF headings (SPEC-corpus-knowledge R1). Pure functions: extraction from a
// resolved outline or from typography metrics, and heading-path resolution for
// chunk positions. PDF I/O stays in PdfExtractor; nothing here touches pdfjs.

/** A document heading anchored to a page (offset within the page is resolved later). */
export interface PdfHeading {
  title: string;
  /** 1-based; smaller = higher in the hierarchy. */
  level: number;
  pageNumber: number;
}

/** A text line with the dominant font size, as reported by the PDF parser. */
export interface PdfTextLine {
  text: string;
  fontSize: number;
  pageNumber: number;
}

const MIN_OUTLINE_HEADINGS = 3;
const MAX_HEADING_LEVELS = 3;
const MAX_HEADING_LENGTH = 120;
const MAX_CAPS_HEADING_LENGTH = 80;
const MIN_HEADING_LENGTH = 4;
const FONT_SIZE_RATIO = 1.15;
const REPEATING_LINE_PAGE_SHARE = 0.3;

/**
 * Choose the heading source for a document: a PDF outline (bookmarks) when it
 * is present and non-trivial, otherwise the typography heuristic. May return
 * an empty list — callers must treat headings as best-effort.
 */
export function resolvePdfHeadings(
  outline: PdfHeading[],
  lines: PdfTextLine[],
  pageCount: number,
): PdfHeading[] {
  if (outline.length >= MIN_OUTLINE_HEADINGS) {
    return outline.map((heading) => ({
      ...heading,
      level: Math.min(Math.max(1, heading.level), MAX_HEADING_LEVELS),
    }));
  }

  return headingsFromTypography(lines, pageCount);
}

/**
 * Typography heuristic: a line is a heading candidate when its font is clearly
 * larger than the document median, or it is short ALL-CAPS text. Header/footer
 * noise is removed by dropping lines whose text repeats across many pages, and
 * the whole result is discarded when candidates are implausibly dense.
 */
export function headingsFromTypography(lines: PdfTextLine[], pageCount: number): PdfHeading[] {
  if (lines.length === 0 || pageCount === 0) {
    return [];
  }

  const median = medianFontSize(lines);
  const repeating = repeatingLineTexts(lines, pageCount);
  const candidates = lines.filter(
    (line) => isHeadingCandidate(line, median) && !repeating.has(normalizeLineText(line.text)),
  );

  if (candidates.length === 0 || candidates.length > pageCount * 2) {
    return [];
  }

  const levelBySize = headingLevelsBySize(candidates);

  return candidates.map((line) => ({
    title: line.text.trim(),
    level: levelBySize.get(line.fontSize) ?? MAX_HEADING_LEVELS,
    pageNumber: line.pageNumber,
  }));
}

export interface PositionedPdfHeading extends PdfHeading {
  /** Offset of the heading inside the normalized text of its page. */
  offsetInPage: number;
}

/**
 * Anchor headings to offsets inside the normalized page texts (the same texts
 * chunking runs on). A heading whose title cannot be found on its page anchors
 * to the page start — page-level granularity is an accepted approximation.
 */
export function positionHeadings(
  headings: PdfHeading[],
  normalizedPageText: (pageNumber: number) => string,
): PositionedPdfHeading[] {
  return headings
    .map((heading) => {
      const pageText = normalizedPageText(heading.pageNumber);
      const offset = pageText.indexOf(heading.title.trim());
      return { ...heading, offsetInPage: offset >= 0 ? offset : 0 };
    })
    .sort(
      (left, right) => left.pageNumber - right.pageNumber || left.offsetInPage - right.offsetInPage,
    );
}

/**
 * Resolve the heading path for a chunk position. Maintains a stack of the last
 * seen heading per level, so `["Chapter", "Section"]` nests naturally.
 */
export function headingPathAt(
  headings: PositionedPdfHeading[],
  pageNumber: number,
  offsetInPage: number,
): string[] {
  const stack: PositionedPdfHeading[] = [];

  for (const heading of headings) {
    if (
      heading.pageNumber > pageNumber ||
      (heading.pageNumber === pageNumber && heading.offsetInPage > offsetInPage)
    ) {
      break;
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
  }

  return stack.map((heading) => heading.title);
}

function isHeadingCandidate(line: PdfTextLine, medianSize: number): boolean {
  const text = line.text.trim();

  if (text.length < MIN_HEADING_LENGTH || text.length > MAX_HEADING_LENGTH) {
    return false;
  }
  if (/[.,:;]$/.test(text)) {
    return false;
  }

  const largeFont = medianSize > 0 && line.fontSize > medianSize * FONT_SIZE_RATIO;
  const allCaps = text.length <= MAX_CAPS_HEADING_LENGTH && isAllCapsText(text);

  return largeFont || allCaps;
}

function isAllCapsText(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 4 && text === text.toUpperCase() && text !== text.toLowerCase();
}

function medianFontSize(lines: PdfTextLine[]): number {
  const sizes = lines.map((line) => line.fontSize).sort((left, right) => left - right);
  return sizes[Math.floor(sizes.length / 2)] ?? 0;
}

/** Texts repeating on a large share of pages are running headers/footers, not headings. */
function repeatingLineTexts(lines: PdfTextLine[], pageCount: number): Set<string> {
  const pagesByText = new Map<string, Set<number>>();

  for (const line of lines) {
    const key = normalizeLineText(line.text);
    if (!key) continue;
    const pages = pagesByText.get(key) ?? new Set<number>();
    pages.add(line.pageNumber);
    pagesByText.set(key, pages);
  }

  const threshold = Math.max(2, Math.ceil(pageCount * REPEATING_LINE_PAGE_SHARE));
  const repeating = new Set<string>();

  for (const [text, pages] of pagesByText) {
    if (pages.size > threshold) {
      repeating.add(text);
    }
  }

  return repeating;
}

/** Strip digits so «Chapter title 12» / «Chapter title 13» page headers collapse together. */
function normalizeLineText(text: string): string {
  return text.trim().toLowerCase().replace(/\d+/g, "").replace(/\s+/g, " ").trim();
}

/** Cluster distinct candidate font sizes into at most three heading levels. */
function headingLevelsBySize(candidates: PdfTextLine[]): Map<number, number> {
  const sizes = [...new Set(candidates.map((line) => line.fontSize))].sort(
    (left, right) => right - left,
  );
  const levels = new Map<number, number>();

  sizes.forEach((size, index) => {
    levels.set(size, Math.min(index + 1, MAX_HEADING_LEVELS));
  });

  return levels;
}
