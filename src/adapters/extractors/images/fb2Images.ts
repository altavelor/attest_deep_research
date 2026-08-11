import {
  hasDecodableDimensions,
  imageFormatFromMimeType,
  IMAGE_EXTRACTION_LIMITS,
} from "@core/media";
import { decodeBase64 } from "../base64";
import { readInputText } from "../common";
import type { DocumentImageExtractor, DocumentImageInput, DocumentImageRef } from "./types";

const BINARY = /<binary\b([^>]*)>([\s\S]*?)<\/binary>/gi;

export class Fb2ImageExtractor implements DocumentImageExtractor {
  supports(path: string): boolean {
    return /\.fb2$/i.test(path);
  }

  extract(input: DocumentImageInput): DocumentImageRef[] {
    if (!this.supports(input.path)) return [];
    return extractFb2ImageRefs(readInputText(input.data), input.metadataOnly === true);
  }
}

/** Pure scan over FB2 source; exported for tests and the index manifest. */
export function extractFb2ImageRefs(source: string, metadataOnly: boolean): DocumentImageRef[] {
  const refs: DocumentImageRef[] = [];
  let totalBytes = 0;

  for (const match of source.matchAll(BINARY)) {
    if (refs.length >= IMAGE_EXTRACTION_LIMITS.candidatesPerSource) break;
    const attributes = match[1] ?? "";
    const id = /\bid\s*=\s*"([^"]+)"/i.exec(attributes)?.[1];
    const format = imageFormatFromMimeType(/\bcontent-type\s*=\s*"([^"]+)"/i.exec(attributes)?.[1]);
    if (!id || !format) continue;

    const base64 = (match[2] ?? "").replace(/\s+/g, "");
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) continue;
    const byteLength = Math.floor((base64.length * 3) / 4);
    if (byteLength > IMAGE_EXTRACTION_LIMITS.maxEncodedBytes) continue;
    totalBytes += byteLength;
    if (totalBytes > IMAGE_EXTRACTION_LIMITS.maxTotalEncodedBytes) break;

    let data: Uint8Array | undefined;
    if (!metadataOnly) {
      data = decodeBase64(base64);
      if (!data || data.length === 0) continue;
      if (!hasDecodableDimensions(data, format)) continue;
    }

    refs.push({
      locator: `binary:${id}`,
      format,
      ...(data ? { data } : {}),
    });
  }
  return refs;
}
