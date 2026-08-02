// Raster image objects embedded in a PDF. Only self-contained encodings that a
// browser can display directly (DCTDecode → JPEG) are extracted; other filters
// would need re-encoding and are skipped so the answer degrades to text.

import { IMAGE_EXTRACTION_LIMITS } from "@core/media";
import { readInputBuffer } from "../common";
import type { DocumentImageExtractor, DocumentImageInput, DocumentImageRef } from "./types";

const OBJECT_HEADER = /(\d+)\s+(\d+)\s+obj\b/g;
const PAGE_MARKER = /\/Type\s*\/Page[^s]/;
const XOBJECT_REF = /\/XObject\s*<<([\s\S]{0,4000}?)>>/;
const OBJECT_REFERENCE = /(\d+)\s+\d+\s+R/g;

export class PdfImageExtractor implements DocumentImageExtractor {
  supports(path: string): boolean {
    return /\.pdf$/i.test(path);
  }

  extract(input: DocumentImageInput): DocumentImageRef[] {
    if (!this.supports(input.path)) return [];
    try {
      return extractPdfImageRefs(readInputBuffer(input.data), input.metadataOnly === true);
    } catch {
      return [];
    }
  }
}

interface PdfObject {
  number: number;
  headerEnd: number;
  end: number;
}

/** Pure scan over PDF bytes; exported for tests and the index manifest. */
export function extractPdfImageRefs(buffer: Buffer, metadataOnly: boolean): DocumentImageRef[] {
  const objects = indexObjects(buffer);
  const pageByObject = mapObjectsToPages(buffer, objects);
  const refs: DocumentImageRef[] = [];
  const ordinalByPage = new Map<number, number>();
  let totalBytes = 0;

  for (const object of objects) {
    if (refs.length >= IMAGE_EXTRACTION_LIMITS.candidatesPerSource) break;
    const header = buffer.toString(
      "latin1",
      object.headerEnd,
      Math.min(object.headerEnd + 2000, object.end),
    );
    if (!/\/Subtype\s*\/Image/.test(header)) continue;
    if (!/\/Filter\s*(\[\s*)?\/DCTDecode/.test(header)) continue;

    const width = dictNumber(header, "Width");
    const height = dictNumber(header, "Height");
    if (width !== undefined && height !== undefined) {
      if (
        width < IMAGE_EXTRACTION_LIMITS.minEdgePixels ||
        height < IMAGE_EXTRACTION_LIMITS.minEdgePixels ||
        width * height > IMAGE_EXTRACTION_LIMITS.maxPixels
      ) {
        continue;
      }
    }

    const stream = readStream(buffer, object);
    if (!stream) continue;
    if (stream.length > IMAGE_EXTRACTION_LIMITS.maxEncodedBytes) continue;
    totalBytes += stream.length;
    if (totalBytes > IMAGE_EXTRACTION_LIMITS.maxTotalEncodedBytes) break;

    const page = pageByObject.get(object.number) ?? 0;
    const ordinal = ordinalByPage.get(page) ?? 0;
    ordinalByPage.set(page, ordinal + 1);

    refs.push({
      locator: `page:${page}:${ordinal}`,
      format: "jpeg",
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(metadataOnly ? {} : { data: new Uint8Array(stream) }),
    });
  }
  return refs;
}

function indexObjects(buffer: Buffer): PdfObject[] {
  const source = buffer.toString("latin1");
  const objects: PdfObject[] = [];
  OBJECT_HEADER.lastIndex = 0;
  let match: RegExpExecArray | null;
  const starts: Array<{ number: number; headerEnd: number }> = [];

  while ((match = OBJECT_HEADER.exec(source)) !== null) {
    starts.push({
      number: Number.parseInt(match[1]!, 10),
      headerEnd: match.index + match[0].length,
    });
    if (starts.length > 100_000) break;
  }
  for (let index = 0; index < starts.length; index += 1) {
    objects.push({
      number: starts[index]!.number,
      headerEnd: starts[index]!.headerEnd,
      end: starts[index + 1]?.headerEnd ?? buffer.length,
    });
  }
  return objects;
}

/** Associates image XObjects with the 1-based page that references them. */
function mapObjectsToPages(buffer: Buffer, objects: PdfObject[]): Map<number, number> {
  const pageByObject = new Map<number, number>();
  let pageNumber = 0;

  for (const object of objects) {
    const header = buffer.toString(
      "latin1",
      object.headerEnd,
      Math.min(object.headerEnd + 4000, object.end),
    );
    if (!PAGE_MARKER.test(header)) continue;
    pageNumber += 1;
    const xobjects = XOBJECT_REF.exec(header)?.[1] ?? "";
    OBJECT_REFERENCE.lastIndex = 0;
    let reference: RegExpExecArray | null;
    while ((reference = OBJECT_REFERENCE.exec(xobjects)) !== null) {
      const target = Number.parseInt(reference[1]!, 10);
      if (!pageByObject.has(target)) pageByObject.set(target, pageNumber);
    }
  }
  return pageByObject;
}

function readStream(buffer: Buffer, object: PdfObject): Buffer | undefined {
  const region = buffer.subarray(object.headerEnd, object.end);
  const start = region.indexOf("stream", 0, "latin1");
  if (start === -1) return undefined;
  let dataStart = start + "stream".length;
  if (region[dataStart] === 0x0d) dataStart += 1;
  if (region[dataStart] === 0x0a) dataStart += 1;
  const end = region.indexOf("endstream", dataStart, "latin1");
  if (end === -1 || end <= dataStart) return undefined;
  return Buffer.from(region.subarray(dataStart, end));
}

function dictNumber(header: string, key: string): number | undefined {
  const match = new RegExp(`/${key}\\s+(\\d+)`).exec(header);
  const value = match ? Number.parseInt(match[1]!, 10) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
