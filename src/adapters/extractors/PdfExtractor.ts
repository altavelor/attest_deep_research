import { AttestError } from "@core/errors";
import { positiveIntegerOrDefault } from "@shared";
import { Extractor, ExtractorInput } from "@application/ports";
import { ExtractedChunk, PdfSourceReference } from "@core/model";
import { PdfTextCache } from "./PdfTextCache";
import {
  headingPathAt,
  PdfHeading,
  PdfTextLine,
  PositionedPdfHeading,
  positionHeadings,
  resolvePdfHeadings,
} from "./pdfHeadings";
import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_LENGTH,
  fileNameFromPath,
  normalizePath,
  normalizeText,
  splitText,
  stableId,
} from "./common";

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export interface PdfPageTextParser {
  parsePages(data: ArrayBuffer): AsyncIterable<PdfPageText>;
  parseDocument?(data: ArrayBuffer): Promise<PdfParsedDocument>;
}

export interface PdfParsedDocument {
  pages: PdfPageText[];
  outline: PdfHeading[];
  lines: PdfTextLine[];
}

export interface PdfExtractorOptions {
  parser?: PdfPageTextParser;
  maxChunkLength?: number;
  chunkOverlap?: number;
  pageConcurrency?: number;
  cache?: PdfTextCache;
}

type PdfTextContentItem = {
  str?: string;
  hasEOL?: boolean;
  height?: number;
  transform?: number[];
};

export class PdfExtractor implements Extractor {
  private readonly parser: PdfPageTextParser;
  private readonly maxChunkLength: number;
  private readonly chunkOverlap: number;
  private readonly cache?: PdfTextCache;

  constructor(options: PdfExtractorOptions = {}) {
    this.parser =
      options.parser ?? new PdfJsTextParser({ pageConcurrency: options.pageConcurrency });
    this.maxChunkLength = options.maxChunkLength ?? DEFAULT_CHUNK_LENGTH;
    this.chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    this.cache = options.cache;
  }

  supports(path: string): boolean {
    return path.toLowerCase().endsWith(".pdf");
  }

  async extract(input: ExtractorInput): Promise<ExtractedChunk[]> {
    if (!this.supports(input.path)) {
      return [];
    }

    const data =
      typeof input.data === "string" ? new TextEncoder().encode(input.data).buffer : input.data;
    const size = input.size ?? data.byteLength;
    const cached = this.cache?.get(input.path, { mtime: input.modifiedTime, size });
    const chunks: ExtractedChunk[] = [];

    try {
      const { pages, headings } =
        cached !== null && cached !== undefined
          ? { pages: cached.content, headings: cached.headings ?? [] }
          : await this.parseAndCachePages(input.path, data, { mtime: input.modifiedTime, size });

      const normalizedTextByPage = new Map<number, string>();
      for (const page of pages) {
        normalizedTextByPage.set(page.pageNumber, normalizeText(page.text));
      }
      const positionedHeadings = positionHeadings(
        headings,
        (pageNumber) => normalizedTextByPage.get(pageNumber) ?? "",
      );

      for (const page of pages) {
        const normalizedText = normalizedTextByPage.get(page.pageNumber) ?? "";

        if (!normalizedText) {
          continue;
        }

        chunks.push(
          ...chunkPdfPage({
            path: normalizePath(input.path),
            pageNumber: page.pageNumber,
            text: normalizedText,
            maxChunkLength: this.maxChunkLength,
            chunkOverlap: this.chunkOverlap,
            headings: positionedHeadings,
          }),
        );
      }
    } catch (error) {
      throw new AttestError({
        code: "EXTRACTION_FAILED",
        message: "Attest could not read this PDF.",
        cause: error,
        details: { path: input.path, causeMessage: errorMessage(error) },
      });
    }

    return chunks;
  }

  private async parseAndCachePages(
    path: string,
    data: ArrayBuffer,
    cacheKey: { mtime: number; size: number },
  ): Promise<{ pages: PdfPageText[]; headings: PdfHeading[] }> {
    const parsed = this.parser.parseDocument
      ? await this.parser.parseDocument(data)
      : await collectPages(this.parser.parsePages(data));
    const pages = parsed.pages.map((page) => ({
      pageNumber: page.pageNumber,
      text: normalizeText(page.text),
    }));
    const headings = resolvePdfHeadings(parsed.outline, parsed.lines, pages.length);

    this.cache?.set(path, cacheKey, pages, headings);
    return { pages, headings };
  }
}

async function collectPages(source: AsyncIterable<PdfPageText>): Promise<PdfParsedDocument> {
  const pages: PdfPageText[] = [];

  for await (const page of source) {
    pages.push(page);
  }

  return { pages, outline: [], lines: [] };
}

export class PdfJsTextParser implements PdfPageTextParser {
  private readonly pageConcurrency: number;

  constructor(options: { pageConcurrency?: number } = {}) {
    this.pageConcurrency = positiveIntegerOrDefault(options.pageConcurrency, 3);
  }

  async *parsePages(data: ArrayBuffer): AsyncIterable<PdfPageText> {
    const parsed = await this.parseDocument(data);
    for (const page of parsed.pages) {
      yield page;
    }
  }

  async parseDocument(data: ArrayBuffer): Promise<PdfParsedDocument> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    if (typeof window !== "undefined") {
      const workerWindow = window as typeof window & {
        pdfjsWorker?: { WorkerMessageHandler: unknown };
      };
      workerWindow.pdfjsWorker = {
        WorkerMessageHandler: pdfWorker.WorkerMessageHandler,
      };
    }
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data).slice(),
      useSystemFonts: true,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });

    try {
      const document = await loadingTask.promise;
      const pages: PdfPageText[] = [];
      const lines: PdfTextLine[] = [];

      for (let startPage = 1; startPage <= document.numPages; startPage += this.pageConcurrency) {
        const pageNumbers = Array.from(
          { length: Math.min(this.pageConcurrency, document.numPages - startPage + 1) },
          (_, index) => startPage + index,
        );
        const parsedPages = await Promise.all(
          pageNumbers.map((pageNumber) => parsePdfPage(document, pageNumber)),
        );

        for (const page of parsedPages) {
          pages.push({ pageNumber: page.pageNumber, text: page.text });
          lines.push(...page.lines);
        }
      }

      return { pages, lines, outline: await readOutlineHeadings(document) };
    } finally {
      await loadingTask.destroy();
    }
  }
}

interface PdfJsPage {
  getTextContent(options: { disableCombineTextItems: boolean }): Promise<{
    items: PdfTextContentItem[];
  }>;
}

interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  getOutline?(): Promise<PdfJsOutlineNode[] | null>;
  getDestination?(dest: string): Promise<unknown[] | null>;
  getPageIndex?(ref: unknown): Promise<number>;
}

interface PdfJsOutlineNode {
  title?: string;
  dest?: string | unknown[] | null;
  items?: PdfJsOutlineNode[];
}

async function parsePdfPage(
  document: PdfJsDocument,
  pageNumber: number,
): Promise<PdfPageText & { lines: PdfTextLine[] }> {
  const page = await document.getPage(pageNumber);
  const textContent = await page.getTextContent({
    disableCombineTextItems: false,
  });

  return {
    pageNumber,
    text: formatPdfTextItems(textContent.items),
    lines: linesFromTextItems(textContent.items, pageNumber),
  };
}

/**
 * Resolve the PDF outline (bookmarks) into page-anchored headings. Every step
 * is best-effort: malformed destinations are skipped, never thrown.
 */
async function readOutlineHeadings(document: PdfJsDocument): Promise<PdfHeading[]> {
  if (!document.getOutline || !document.getPageIndex) {
    return [];
  }

  const headings: PdfHeading[] = [];

  const visit = async (nodes: PdfJsOutlineNode[], level: number): Promise<void> => {
    for (const node of nodes) {
      const title = node.title?.trim();

      if (title) {
        const pageNumber = await outlinePageNumber(document, node.dest);
        if (pageNumber !== null) {
          headings.push({ title, level, pageNumber });
        }
      }
      if (node.items && node.items.length > 0) {
        await visit(node.items, level + 1);
      }
    }
  };

  try {
    const outline = await document.getOutline();
    if (outline) {
      await visit(outline, 1);
    }
  } catch {
    return [];
  }

  return headings.sort((left, right) => left.pageNumber - right.pageNumber);
}

async function outlinePageNumber(
  document: PdfJsDocument,
  dest: string | unknown[] | null | undefined,
): Promise<number | null> {
  try {
    const resolved =
      typeof dest === "string" ? await document.getDestination?.(dest) : (dest ?? null);
    const ref = Array.isArray(resolved) ? resolved[0] : null;

    if (ref === null || ref === undefined || !document.getPageIndex) {
      return null;
    }

    return (await document.getPageIndex(ref)) + 1;
  } catch {
    return null;
  }
}

/** Group text items into lines (split on EOL) and record the dominant font size. */
function linesFromTextItems(items: PdfTextContentItem[], pageNumber: number): PdfTextLine[] {
  const lines: PdfTextLine[] = [];
  let textParts: string[] = [];
  let fontSize = 0;

  const flush = () => {
    const text = textParts.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      lines.push({ text, fontSize, pageNumber });
    }
    textParts = [];
    fontSize = 0;
  };

  for (const item of items) {
    if (item.str && item.str.trim()) {
      textParts.push(item.str);
      fontSize = Math.max(fontSize, itemFontSize(item));
    }
    if (item.hasEOL) {
      flush();
    }
  }
  flush();

  return lines;
}

function itemFontSize(item: PdfTextContentItem): number {
  if (typeof item.height === "number" && item.height > 0) {
    return item.height;
  }
  const scaleY = item.transform?.[3];
  return typeof scaleY === "number" ? Math.abs(scaleY) : 0;
}

function chunkPdfPage(options: {
  path: string;
  pageNumber: number;
  text: string;
  maxChunkLength: number;
  chunkOverlap: number;
  headings: PositionedPdfHeading[];
}): ExtractedChunk[] {
  const fileName = fileNameFromPath(options.path);

  return splitText(options.text, options.maxChunkLength, 0, options.chunkOverlap).map(
    (part, index) => {
      const sourceId = stableId(
        `${options.path}:page:${options.pageNumber}:${part.startOffset}:${part.endOffset}:${index}`,
      );
      const headingPath = headingPathAt(options.headings, options.pageNumber, part.startOffset);
      const source: PdfSourceReference = {
        id: sourceId,
        kind: "pdf",
        path: options.path,
        title: `${fileName} p. ${options.pageNumber}`,
        pageNumber: options.pageNumber,
        startOffset: part.startOffset,
        endOffset: part.endOffset,
        ...(headingPath.length > 0 ? { headingPath } : {}),
      };

      return {
        id: sourceId,
        source,
        text: part.text,
        contentHash: stableId(part.text),
      };
    },
  );
}

function formatPdfTextItems(items: PdfTextContentItem[]): string {
  return items
    .map((item) => {
      if (!item.str) {
        return "";
      }

      return item.hasEOL ? `${item.str}\n` : item.str;
    })
    .join(" ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return typeof error === "string" && error.trim() ? error.trim() : undefined;
}
