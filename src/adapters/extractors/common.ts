import { createHash } from "crypto";
import { inflateRawSync } from "zlib";

import { IxplorerError } from "../../core/errors";
export { normalizeVaultPath as normalizePath } from "../../shared/pathFilters";
import { DocumentFormat, DocumentSourceReference, ExtractedChunk } from "@core/model";

export interface DocumentExtractorOptions {
  maxChunkLength?: number;
  chunkOverlap?: number;
}

export interface TextPart {
  text: string;
  startOffset: number;
  endOffset: number;
}

export const DEFAULT_CHUNK_LENGTH = 800;
export const DEFAULT_CHUNK_OVERLAP = 120;

export function normalizeChunkOverlap(maxChunkLength: number, chunkOverlap?: number): number {
  const requestedOverlap = chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

  if (!Number.isFinite(requestedOverlap) || requestedOverlap <= 0) {
    return 0;
  }

  return Math.min(Math.floor(requestedOverlap), Math.max(0, maxChunkLength - 1));
}

export function createDocumentChunks(options: {
  path: string;
  format: DocumentFormat;
  text: string;
  maxChunkLength: number;
  chunkOverlap?: number;
}): ExtractedChunk[] {
  const normalizedText = normalizeText(options.text);

  if (!normalizedText) {
    return [];
  }

  const title = fileNameFromPath(options.path);

  return splitText(normalizedText, options.maxChunkLength, 0, options.chunkOverlap).map(
    (part, index) => {
      const sourceId = stableId(
        `${options.path}:${options.format}:${part.startOffset}:${part.endOffset}:${index}`,
      );
      const source: DocumentSourceReference = {
        id: sourceId,
        kind: "document",
        path: options.path,
        title,
        format: options.format,
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

export function readInputText(data: ArrayBuffer | string): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

export function readInputBuffer(data: ArrayBuffer | string): Buffer {
  return typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
}

export function fileNameFromPath(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function stripXmlTags(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, " "));
}

export function extractionFailed(
  format: DocumentFormat,
  path: string,
  cause: unknown,
): IxplorerError {
  return new IxplorerError({
    code: "EXTRACTION_FAILED",
    message: `Ixplorer could not read this ${format.toUpperCase()} file.`,
    cause,
    details: { path, format },
  });
}

export class ZipArchive {
  private readonly entries: Map<string, Buffer>;

  private constructor(entries: Map<string, Buffer>) {
    this.entries = entries;
  }

  static read(data: ArrayBuffer | string): ZipArchive {
    const buffer = readInputBuffer(data);
    const entries = new Map<string, Buffer>();
    const eocdOffset = findEndOfCentralDirectory(buffer);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    let offset = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error("Invalid ZIP central directory entry.");
      }

      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
      const compressedData = readLocalFileData(buffer, localHeaderOffset, compressedSize);

      if (!fileName.endsWith("/")) {
        entries.set(fileName, inflateZipEntry(compressedData, method));
      }

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return new ZipArchive(entries);
  }

  text(path: string): string | undefined {
    return this.entries.get(path)?.toString("utf8");
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("ZIP end of central directory was not found.");
}

function readLocalFileData(buffer: Buffer, offset: number, compressedSize: number): Buffer {
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error("Invalid ZIP local file header.");
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;

  return buffer.subarray(dataOffset, dataOffset + compressedSize);
}

function inflateZipEntry(data: Buffer, method: number): Buffer {
  if (method === 0) {
    return data;
  }

  if (method === 8) {
    return inflateRawSync(data);
  }

  throw new Error(`Unsupported ZIP compression method: ${method}`);
}

export function splitText(
  text: string,
  maxChunkLength: number,
  baseOffset = 0,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
): TextPart[] {
  const paragraphs = splitParagraphs(text, baseOffset);
  const parts: TextPart[] = [];
  const normalizedOverlap = normalizeChunkOverlap(maxChunkLength, chunkOverlap);
  let currentText = "";
  let currentStartOffset = 0;
  let currentEndOffset = 0;

  for (const paragraph of paragraphs) {
    if (paragraph.text.length > maxChunkLength) {
      flushCurrent();
      parts.push(...splitLongText(paragraph, maxChunkLength, normalizedOverlap));
      continue;
    }

    const separator = currentText ? "\n\n" : "";
    const nextText = `${currentText}${separator}${paragraph.text}`;

    if (currentText && nextText.length > maxChunkLength) {
      flushCurrent();
    }

    if (!currentText) {
      currentStartOffset = paragraph.startOffset;
    }

    currentText = currentText ? `${currentText}\n\n${paragraph.text}` : paragraph.text;
    currentEndOffset = paragraph.endOffset;
  }

  flushCurrent();

  return addChunkOverlap(parts, maxChunkLength, normalizedOverlap);

  function flushCurrent(): void {
    if (!currentText) {
      return;
    }

    parts.push({
      text: currentText,
      startOffset: currentStartOffset,
      endOffset: currentEndOffset,
    });

    currentText = "";
  }
}

function splitParagraphs(text: string, baseOffset: number): TextPart[] {
  const paragraphs: TextPart[] = [];
  const paragraphPattern = /\S[\s\S]*?(?=\r?\n\s*\r?\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = paragraphPattern.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();

    if (trimmed) {
      const leadingWhitespaceLength = raw.length - raw.trimStart().length;
      paragraphs.push({
        text: trimmed,
        startOffset: baseOffset + match.index + leadingWhitespaceLength,
        endOffset: baseOffset + match.index + leadingWhitespaceLength + trimmed.length,
      });
    }
  }

  return paragraphs;
}

function splitLongText(part: TextPart, maxChunkLength: number, chunkOverlap = 0): TextPart[] {
  const chunks: TextPart[] = [];
  const step = Math.max(
    1,
    maxChunkLength - Math.max(0, Math.min(chunkOverlap, maxChunkLength - 1)),
  );

  for (let start = 0; start < part.text.length; start += step) {
    const adjustedStart = start === 0 ? 0 : alignToWordStart(part.text, start);
    const rawText = part.text.slice(adjustedStart, adjustedStart + maxChunkLength);
    const leadingWhitespaceLength = rawText.length - rawText.trimStart().length;
    const text = rawText.trim();

    if (text) {
      chunks.push({
        text,
        startOffset: part.startOffset + adjustedStart + leadingWhitespaceLength,
        endOffset: part.startOffset + adjustedStart + leadingWhitespaceLength + text.length,
      });
    }
  }

  return chunks;
}

function alignToWordStart(text: string, start: number): number {
  if (start <= 0 || /\s/.test(text[start] ?? "") || /\s/.test(text[start - 1] ?? "")) {
    return start;
  }

  for (let index = start - 1; index >= 0; index -= 1) {
    if (/\s/.test(text[index])) {
      return index + 1;
    }
  }

  return start;
}

function addChunkOverlap(
  parts: TextPart[],
  maxChunkLength: number,
  chunkOverlap: number,
): TextPart[] {
  if (chunkOverlap <= 0 || parts.length <= 1) {
    return parts;
  }

  return parts.map((part, index) => {
    if (index === 0) {
      return part;
    }

    const previous = parts[index - 1];
    const separatorLength = 2;
    const availableOverlap = maxChunkLength - part.text.length - separatorLength;

    if (!previous || availableOverlap <= 0) {
      return part;
    }

    const overlap = overlapSuffix(previous.text, Math.min(chunkOverlap, availableOverlap));

    if (!overlap) {
      return part;
    }

    return {
      text: `${overlap}\n\n${part.text}`,
      startOffset: Math.max(previous.startOffset, previous.endOffset - overlap.length),
      endOffset: part.endOffset,
    };
  });
}

function overlapSuffix(text: string, maxLength: number): string {
  const trimmed = text.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const suffix = trimmed.slice(-maxLength);
  const boundary = suffix.search(/\s/);

  return boundary >= 0 ? suffix.slice(boundary).trim() : suffix.trim();
}
