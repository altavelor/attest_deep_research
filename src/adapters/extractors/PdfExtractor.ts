import { inflateSync } from "zlib";

import { IxplorerError } from "../../core/errors";
import { positiveIntegerOrDefault } from "@shared";
import { Extractor, ExtractorInput } from "@application/ports";
import { ExtractedChunk, PdfSourceReference } from "@core/model";
import { PdfTextCache } from "./PdfTextCache";
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
}

export interface PdfExtractorOptions {
  parser?: PdfPageTextParser;
  maxChunkLength?: number;
  chunkOverlap?: number;
  pageConcurrency?: number;
  cache?: PdfTextCache;
}

type UnicodeMap = Map<number, string>;
type PdfTextContentItem = {
  str?: string;
  hasEOL?: boolean;
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
    const size = input.size ?? byteLength(data);
    const cached = this.cache?.get(input.path, { mtime: input.modifiedTime, size });
    const chunks: ExtractedChunk[] = [];

    try {
      const pages = cached?.content ?? (await this.parseAndCachePages(input.path, data, {
        mtime: input.modifiedTime,
        size,
      }));

      for (const page of pages) {
        const normalizedText = normalizeText(page.text);

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
          }),
        );
      }
    } catch (error) {
      throw new IxplorerError({
        code: "EXTRACTION_FAILED",
        message: "Ixplorer could not read this PDF.",
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
  ): Promise<PdfPageText[]> {
    const pages: PdfPageText[] = [];

    for await (const page of this.parser.parsePages(data)) {
      pages.push({
        pageNumber: page.pageNumber,
        text: normalizeText(page.text),
      });
    }

    this.cache?.set(path, cacheKey, pages);
    return pages;
  }
}

export class PdfJsTextParser implements PdfPageTextParser {
  private readonly pageConcurrency: number;

  constructor(options: { pageConcurrency?: number } = {}) {
    this.pageConcurrency = positiveIntegerOrDefault(options.pageConcurrency, 3);
  }

  async *parsePages(data: ArrayBuffer): AsyncIterable<PdfPageText> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const workerGlobal = globalThis as typeof globalThis & {
      pdfjsWorker?: { WorkerMessageHandler: unknown };
    };
    workerGlobal.pdfjsWorker = {
      WorkerMessageHandler: pdfWorker.WorkerMessageHandler,
    };
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data).slice(),
      useSystemFonts: true,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });

    try {
      const document = await loadingTask.promise;

      for (let startPage = 1; startPage <= document.numPages; startPage += this.pageConcurrency) {
        const pageNumbers = Array.from(
          { length: Math.min(this.pageConcurrency, document.numPages - startPage + 1) },
          (_, index) => startPage + index,
        );
        const pages = await Promise.all(
          pageNumbers.map((pageNumber) => parsePdfPage(document, pageNumber)),
        );

        for (const page of pages) {
          yield page;
        }
      }
    } finally {
      await loadingTask.destroy();
    }
  }
}

async function parsePdfPage(
  document: { getPage(pageNumber: number): Promise<PdfJsPage> },
  pageNumber: number,
): Promise<PdfPageText> {
  const page = await document.getPage(pageNumber);
  const textContent = await page.getTextContent({
    disableCombineTextItems: false,
  });

  return {
    pageNumber,
    text: formatPdfTextItems(textContent.items),
  };
}

interface PdfJsPage {
  getTextContent(options: { disableCombineTextItems: boolean }): Promise<{
    items: PdfTextContentItem[];
  }>;
}

export class SimplePdfTextParser implements PdfPageTextParser {
  async *parsePages(data: ArrayBuffer): AsyncIterable<PdfPageText> {
    const source = Buffer.from(data).toString("latin1");
    const objects = parsePdfObjects(source);
    const pages = [...objects.entries()]
      .filter(([, body]) => /\/Type\s*\/Page\b/.test(body))
      .map(([objectNumber, body]) => ({ objectNumber, body }))
      .sort((left, right) => left.objectNumber - right.objectNumber);

    for (let index = 0; index < pages.length; index += 1) {
      const fontMaps = readPageFontMaps(pages[index].body, objects);
      const contentObjectNumbers = readContentObjectNumbers(pages[index].body);
      const text = contentObjectNumbers
        .map((objectNumber) => objects.get(objectNumber) ?? "")
        .map(extractStream)
        .filter((stream): stream is string => stream !== null)
        .flatMap((stream) => extractTextOperations(stream, fontMaps))
        .join("\n");

      yield {
        pageNumber: index + 1,
        text,
      };
    }
  }
}

function chunkPdfPage(options: {
  path: string;
  pageNumber: number;
  text: string;
  maxChunkLength: number;
  chunkOverlap: number;
}): ExtractedChunk[] {
  const fileName = fileNameFromPath(options.path);

  return splitText(options.text, options.maxChunkLength, 0, options.chunkOverlap).map(
    (part, index) => {
      const sourceId = stableId(
        `${options.path}:page:${options.pageNumber}:${part.startOffset}:${part.endOffset}:${index}`,
      );
      const source: PdfSourceReference = {
        id: sourceId,
        kind: "pdf",
        path: options.path,
        title: `${fileName} p. ${options.pageNumber}`,
        pageNumber: options.pageNumber,
        startOffset: part.startOffset,
        endOffset: part.endOffset,
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

function byteLength(data: ArrayBuffer): number {
  return data.byteLength;
}

function parsePdfObjects(source: string): Map<number, string> {
  const objects = new Map<number, string>();
  const objectPattern = /(\d+)\s+\d+\s+obj\s*([\s\S]*?)\s*endobj/g;
  let match: RegExpExecArray | null;

  while ((match = objectPattern.exec(source)) !== null) {
    objects.set(Number(match[1]), match[2]);
  }

  return objects;
}

function readContentObjectNumbers(pageObject: string): number[] {
  const directMatch = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pageObject);

  if (directMatch) {
    return [Number(directMatch[1])];
  }

  const arrayMatch = /\/Contents\s*\[([\s\S]*?)\]/.exec(pageObject);

  if (!arrayMatch) {
    return [];
  }

  return [...arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
}

function extractStream(objectBody: string): string | null {
  const match = /stream\r?\n?([\s\S]*?)\r?\n?endstream/.exec(objectBody);

  if (!match) {
    return null;
  }

  if (!/\/Filter\s*\/FlateDecode\b/.test(objectBody)) {
    return match[1];
  }

  return inflateSync(Buffer.from(unwrapPdfStreamData(match[1]), "latin1")).toString("latin1");
}

function unwrapPdfStreamData(value: string): string {
  return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function readPageFontMaps(
  pageObject: string,
  objects: Map<number, string>,
): Map<string, UnicodeMap> {
  const fontMaps = new Map<string, UnicodeMap>();
  const fontReferences = [...pageObject.matchAll(/\/(F\d+)\s+(\d+)\s+\d+\s+R/g)];

  for (const match of fontReferences) {
    const fontName = match[1];
    const fontObject = objects.get(Number(match[2])) ?? "";
    const toUnicodeObjectNumber = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontObject)?.[1];

    if (!toUnicodeObjectNumber) {
      continue;
    }

    const toUnicodeObject = objects.get(Number(toUnicodeObjectNumber)) ?? "";
    const stream = extractStream(toUnicodeObject);

    if (stream) {
      fontMaps.set(fontName, parseToUnicodeCMap(stream));
    }
  }

  return fontMaps;
}

function parseToUnicodeCMap(cmap: string): UnicodeMap {
  const unicodeMap: UnicodeMap = new Map();
  const bfcharPattern = /beginbfchar([\s\S]*?)endbfchar/g;
  const bfrangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
  let match: RegExpExecArray | null;

  while ((match = bfcharPattern.exec(cmap)) !== null) {
    for (const entry of match[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) {
      unicodeMap.set(Number.parseInt(entry[1], 16), decodeUnicodeHex(entry[2]));
    }
  }

  while ((match = bfrangePattern.exec(cmap)) !== null) {
    for (const entry of match[1].matchAll(
      /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g,
    )) {
      const start = Number.parseInt(entry[1], 16);
      const end = Number.parseInt(entry[2], 16);
      const destinationStart = Number.parseInt(entry[3], 16);

      for (let code = start; code <= end; code += 1) {
        unicodeMap.set(code, String.fromCodePoint(destinationStart + code - start));
      }
    }
  }

  return unicodeMap;
}

function extractTextOperations(stream: string, fontMaps: Map<string, UnicodeMap>): string[] {
  const text: string[] = [];
  const operationPattern =
    /\/([A-Za-z0-9]+)\s+[-\d.]+\s+Tf|(\((?:\\.|[^\\)])*\))\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|\[([\s\S]*?)\]\s*TJ/g;
  let match: RegExpExecArray | null;
  let currentFontMap: UnicodeMap | undefined;

  while ((match = operationPattern.exec(stream)) !== null) {
    if (match[1]) {
      currentFontMap = fontMaps.get(match[1]);
    } else if (match[2]) {
      text.push(decodePdfLiteralString(match[2]));
    } else if (match[3]) {
      text.push(decodePdfHexString(match[3], currentFontMap));
    } else if (match[4]) {
      text.push(
        [...match[4].matchAll(/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g)]
          .map((item) =>
            item[1] ? decodePdfHexString(item[1], currentFontMap) : decodePdfLiteralString(item[0]),
          )
          .join(""),
      );
    }
  }

  return text.map((item) => item.trim()).filter(Boolean);
}

function decodePdfHexString(value: string, unicodeMap: UnicodeMap | undefined): string {
  const hex = value.replace(/\s/g, "");
  let decoded = "";

  for (let index = 0; index < hex.length; index += 4) {
    const code = Number.parseInt(hex.slice(index, index + 4), 16);

    if (Number.isNaN(code)) {
      continue;
    }

    decoded += unicodeMap?.get(code) ?? String.fromCodePoint(code);
  }

  return decoded;
}

function decodeUnicodeHex(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index += 4) {
    const codePoint = Number.parseInt(value.slice(index, index + 4), 16);

    if (!Number.isNaN(codePoint)) {
      decoded += String.fromCodePoint(codePoint);
    }
  }

  return decoded;
}

function decodePdfLiteralString(value: string): string {
  const body = value.slice(1, -1);
  let decoded = "";

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (character !== "\\") {
      decoded += character;
      continue;
    }

    index += 1;
    const escaped = body[index];
    decoded += decodePdfEscape(escaped);
  }

  return decoded;
}

function decodePdfEscape(value: string | undefined): string {
  switch (value) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "(":
    case ")":
    case "\\":
      return value;
    default:
      return value ?? "";
  }
}
