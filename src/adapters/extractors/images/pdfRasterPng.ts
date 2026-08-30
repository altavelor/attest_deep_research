import { deflateZlib, inflateZlib } from "@shared";

import { concatBytes, writeUint32BE } from "../bytes";

export interface PdfRasterSpec {
  width: number;
  height: number;
  bitsPerComponent: number;
  components: number;
  predictor: number;
  predictorColumns: number;
  predictorColors: number;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Converts a Flate-compressed raster into a PNG, or undefined when unsupported. */
export function pdfRasterToPng(stream: Uint8Array, spec: PdfRasterSpec): Uint8Array | undefined {
  if (spec.bitsPerComponent !== 8) return undefined;
  if (spec.components !== 1 && spec.components !== 3) return undefined;
  if (spec.width <= 0 || spec.height <= 0) return undefined;

  const rowBytes = spec.width * spec.components;
  const predicted = spec.predictor >= 10;
  if (predicted && !hasConsistentPredictor(spec)) return undefined;

  let samples: Uint8Array;
  try {
    samples = inflateZlib(stream, {
      maxOutputLength: spec.height * (rowBytes + (predicted ? 1 : 0)),
    });
  } catch {
    return undefined;
  }

  if (predicted) {
    const undone = undoPngPredictor(samples, spec);
    if (!undone) return undefined;
    samples = undone;
  } else if (spec.predictor !== 1) {
    return undefined;
  }
  if (samples.length < rowBytes * spec.height) return undefined;

  return encodePng(samples, spec.width, spec.height, spec.components);
}

/**
 * Predictor parameters come from an untrusted dictionary. They must describe
 * the same raster as the image dictionary, or the row geometry used to bound
 * the inflated output would not match what is actually decoded.
 */
function hasConsistentPredictor(spec: PdfRasterSpec): boolean {
  return spec.predictorColumns === spec.width && spec.predictorColors === spec.components;
}

/** Reverses the per-row PNG filters PDF applies when `/Predictor >= 10`. */
function undoPngPredictor(data: Uint8Array, spec: PdfRasterSpec): Uint8Array | undefined {
  const colors = spec.predictorColors > 0 ? spec.predictorColors : spec.components;
  const columns = spec.predictorColumns > 0 ? spec.predictorColumns : spec.width;
  const pixelBytes = Math.max(1, colors);
  const rowBytes = columns * colors;
  const rows = Math.floor(data.length / (rowBytes + 1));
  if (rows <= 0) return undefined;

  const output = new Uint8Array(rows * rowBytes);
  let previous = new Uint8Array(rowBytes);

  for (let row = 0; row < rows; row += 1) {
    const start = row * (rowBytes + 1);
    const filter = data[start];
    if (filter > 4) return undefined;
    const current = data.slice(start + 1, start + 1 + rowBytes);

    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= pixelBytes ? current[index - pixelBytes] : 0;
      const up = previous[index];
      const upLeft = index >= pixelBytes ? previous[index - pixelBytes] : 0;
      const raw = current[index];
      current[index] = unfilterByte(filter, raw, left, up, upLeft);
    }
    output.set(current, row * rowBytes);
    previous = current;
  }
  return output;
}

/** Called only for selectors the caller already validated as 0–4. */
function unfilterByte(
  filter: number,
  raw: number,
  left: number,
  up: number,
  upLeft: number,
): number {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return (raw + left) & 0xff;
    case 2:
      return (raw + up) & 0xff;
    case 3:
      return (raw + ((left + up) >> 1)) & 0xff;
    case 4:
      return (raw + paeth(left, up, upLeft)) & 0xff;
    default:
      return raw;
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distLeft = Math.abs(estimate - left);
  const distUp = Math.abs(estimate - up);
  const distUpLeft = Math.abs(estimate - upLeft);
  if (distLeft <= distUp && distLeft <= distUpLeft) return left;
  return distUp <= distUpLeft ? up : upLeft;
}

function encodePng(
  samples: Uint8Array,
  width: number,
  height: number,
  components: number,
): Uint8Array {
  const rowBytes = width * components;
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (rowBytes + 1)] = 0;
    raw.set(samples.subarray(row * rowBytes, (row + 1) * rowBytes), row * (rowBytes + 1) + 1);
  }

  const header = new Uint8Array(13);
  writeUint32BE(header, 0, width);
  writeUint32BE(header, 4, height);
  header[8] = 8;
  header[9] = components === 1 ? 0 : 2;

  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateZlib(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  writeUint32BE(length, 0, data.length);
  const body = concatBytes([asciiBytes(type), data]);
  const crc = new Uint8Array(4);
  writeUint32BE(crc, 0, crc32(body));
  return concatBytes([length, body, crc]);
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
