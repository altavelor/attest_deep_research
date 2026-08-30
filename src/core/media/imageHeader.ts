import { hasDisplayableDimensions } from "./imagePolicy";
import type { EligibleImageFormat } from "./imagePolicy";

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Reads the intrinsic size out of an image header. Returns undefined when the
 * container is unsupported or truncated; callers treat that as "not displayable"
 * rather than trusting the encoded length.
 */
export function readImageDimensions(
  data: Uint8Array,
  format: EligibleImageFormat,
): ImageDimensions | undefined {
  switch (format) {
    case "png":
      return readPngDimensions(data);
    case "jpeg":
      return readJpegDimensions(data);
    case "gif":
      return readGifDimensions(data);
    case "webp":
      return readWebpDimensions(data);
    case "avif":
      return readAvifDimensions(data);
    default:
      return undefined;
  }
}

/** True when the header declares a size within the displayable bounds. */
export function hasDecodableDimensions(data: Uint8Array, format: EligibleImageFormat): boolean {
  const dimensions = readImageDimensions(data, format);
  if (!dimensions) return false;
  return hasDisplayableDimensions(dimensions.width, dimensions.height);
}

function u16(data: Uint8Array, offset: number): number | undefined {
  if (offset + 1 >= data.length) return undefined;
  return (data[offset] << 8) | data[offset + 1];
}

function u32(data: Uint8Array, offset: number): number | undefined {
  if (offset + 3 >= data.length) return undefined;
  return (
    data[offset] * 0x1000000 + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3]
  );
}

function u16le(data: Uint8Array, offset: number): number | undefined {
  if (offset + 1 >= data.length) return undefined;
  return data[offset] | (data[offset + 1] << 8);
}

function readPngDimensions(data: Uint8Array): ImageDimensions | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || signature.some((byte, index) => data[index] !== byte)) return undefined;
  const width = u32(data, 16);
  const height = u32(data, 20);
  return width && height ? { width, height } : undefined;
}

function readGifDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 10 || data[0] !== 0x47 || data[1] !== 0x49 || data[2] !== 0x46) {
    return undefined;
  }
  const width = u16le(data, 6);
  const height = u16le(data, 8);
  return width && height ? { width, height } : undefined;
}

/** Walks JPEG segments to the first frame header (SOF0–SOF15, excluding markers). */
function readJpegDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = u16(data, offset + 2);
    if (length === undefined || length < 2) return undefined;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = u16(data, offset + 5);
      const width = u16(data, offset + 7);
      return width && height ? { width, height } : undefined;
    }
    offset += 2 + length;
  }
  return undefined;
}

/** Supports the lossy (VP8), lossless (VP8L) and extended (VP8X) chunk layouts. */
function readWebpDimensions(data: Uint8Array): ImageDimensions | undefined {
  const isRiff = data.length >= 16 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46;
  const isWebp = data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
  if (!isRiff || !isWebp) return undefined;

  const chunk = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (chunk === "VP8 ") {
    const width = u16le(data, 26);
    const height = u16le(data, 28);
    return width && height ? { width: width & 0x3fff, height: height & 0x3fff } : undefined;
  }
  if (chunk === "VP8L") {
    if (data.length < 25) return undefined;
    const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (chunk === "VP8X") {
    if (data.length < 30) return undefined;
    const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
    const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
    return { width, height };
  }
  return undefined;
}

const MAX_ISOBMFF_SCAN_BYTES = 65_536;

/**
 * AVIF stores the display size in an ISOBMFF `ispe` box inside `meta`. The scan
 * is bounded in both depth and bytes, and only the first `ispe` is read, which
 * is the primary item's size for the single-image files the extractors accept.
 */
function readAvifDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 16) return undefined;
  const brand = String.fromCharCode(data[4], data[5], data[6], data[7]);
  if (brand !== "ftyp") return undefined;
  return findIspeBox(data, 0, Math.min(data.length, MAX_ISOBMFF_SCAN_BYTES), 0);
}

function findIspeBox(
  data: Uint8Array,
  start: number,
  end: number,
  depth: number,
): ImageDimensions | undefined {
  if (depth > 4) return undefined;
  let offset = start;

  while (offset + 8 <= end) {
    const size = u32(data, offset);
    if (size === undefined) return undefined;
    const type = String.fromCharCode(
      data[offset + 4],
      data[offset + 5],
      data[offset + 6],
      data[offset + 7],
    );
    const boxEnd = size === 0 ? end : offset + size;
    if (size !== 0 && (size < 8 || boxEnd > end)) return undefined;

    if (type === "ispe") {
      const width = u32(data, offset + 12);
      const height = u32(data, offset + 16);
      return width && height ? { width, height } : undefined;
    }
    if (type === "meta") {
      const found = findIspeBox(data, offset + 12, boxEnd, depth + 1);
      if (found) return found;
    } else if (type === "iprp" || type === "ipco") {
      const found = findIspeBox(data, offset + 8, boxEnd, depth + 1);
      if (found) return found;
    }
    offset = boxEnd;
  }
  return undefined;
}
