import { createHash } from "crypto";
import { inflateRawSync } from "zlib";

import { IxplorerError } from "../shared/errors";
import { DocumentFormat, DocumentSourceReference, ExtractedChunk } from "../shared/types";

export interface DocumentExtractorOptions {
  maxChunkLength?: number;
}

export interface TextPart {
  text: string;
  startOffset: number;
  endOffset: number;
}

export const DEFAULT_CHUNK_LENGTH = 1_600;

export function createDocumentChunks(options: {
  path: string;
  format: DocumentFormat;
  text: string;
  maxChunkLength: number;
}): ExtractedChunk[] {
  const normalizedText = normalizeText(options.text);

  if (!normalizedText) {
    return [];
  }

  const title = fileNameFromPath(options.path);

  return splitText(normalizedText, options.maxChunkLength).map((part, index) => {
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
  });
}

export function readInputText(data: ArrayBuffer | string): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

export function readInputBuffer(data: ArrayBuffer | string): Buffer {
  return typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
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

export function splitText(text: string, maxChunkLength: number, baseOffset = 0): TextPart[] {
  const paragraphs = splitParagraphs(text, baseOffset);
  const parts: TextPart[] = [];
  let currentText = "";
  let currentStartOffset = 0;
  let currentEndOffset = 0;

  for (const paragraph of paragraphs) {
    if (paragraph.text.length > maxChunkLength) {
      flushCurrent();
      parts.push(...splitLongText(paragraph, maxChunkLength));
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

  return parts;

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

function splitLongText(part: TextPart, maxChunkLength: number): TextPart[] {
  const chunks: TextPart[] = [];

  for (let start = 0; start < part.text.length; start += maxChunkLength) {
    const text = part.text.slice(start, start + maxChunkLength).trim();

    if (text) {
      chunks.push({
        text,
        startOffset: part.startOffset + start,
        endOffset: part.startOffset + start + text.length,
      });
    }
  }

  return chunks;
}