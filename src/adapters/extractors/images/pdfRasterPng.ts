// Re-encodes the PDF raster encodings a browser cannot display directly. Only
// the unambiguous cases are converted: 8-bit DeviceGray and DeviceRGB samples
// compressed with FlateDecode, optionally PNG-predicted. Anything else (CMYK,
// indexed palettes, sub-byte depths, image masks, JPX) is left to the caller to
// skip, so no image is ever shown with guessed colours.

import { deflateSync, inflateSync } from "zlib";

export interface PdfRasterSpec {
  width: number;
  height: number;
  bitsPerComponent: number;
  components: number;
  predictor: number;
  predictorColumns: number;
  predictorColors: number;
}

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

/** Converts a Flate-compressed raster into a PNG, or undefined when unsupported. */
export function pdfRasterToPng(stream: Buffer, spec: PdfRasterSpec): Buffer | undefined {
  if (spec.bitsPerComponent !== 8) return undefined;
  if (spec.components !== 1 && spec.components !== 3) return undefined;
  if (spec.width <= 0 || spec.height <= 0) return undefined;

  const rowBytes = spec.width * spec.components;
  const predicted = spec.predictor >= 10;
  if (predicted && !hasConsistentPredictor(spec)) return undefined;

  let samples: Buffer;
  try {
    samples = inflateSync(stream, {
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
function undoPngPredictor(data: Buffer, spec: PdfRasterSpec): Buffer | undefined {
  const colors = spec.predictorColors > 0 ? spec.predictorColors : spec.components;
  const columns = spec.predictorColumns > 0 ? spec.predictorColumns : spec.width;
  const pixelBytes = Math.max(1, colors);
  const rowBytes = columns * colors;
  const rows = Math.floor(data.length / (rowBytes + 1));
  if (rows <= 0) return undefined;

  const output = Buffer.alloc(rows * rowBytes);
  let previous = Buffer.alloc(rowBytes);

  for (let row = 0; row < rows; row += 1) {
    const start = row * (rowBytes + 1);
    const filter = data[start]!;
    const current = Buffer.from(data.subarray(start + 1, start + 1 + rowBytes));

    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= pixelBytes ? current[index - pixelBytes]! : 0;
      const up = previous[index]!;
      const upLeft = index >= pixelBytes ? previous[index - pixelBytes]! : 0;
      const raw = current[index]!;
      current[index] = unfilterByte(filter, raw, left, up, upLeft);
    }
    current.copy(output, row * rowBytes);
    previous = current;
  }
  return output;
}

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

function encodePng(samples: Buffer, width: number, height: number, components: number): Buffer {
  const rowBytes = width * components;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (rowBytes + 1)] = 0;
    samples.copy(raw, row * (rowBytes + 1) + 1, row * rowBytes, (row + 1) * rowBytes);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(components === 1 ? 0 : 2, 9);

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
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

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
