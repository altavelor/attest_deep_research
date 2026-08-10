export interface InflateOptions {
  maxOutputLength?: number;
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

class CorruptCompressedDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptCompressedDataError";
  }
}

interface HuffmanTable {
  counts: Int32Array;
  symbols: Int32Array;
}

class BitReader {
  private position = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(private readonly data: Uint8Array) {}

  readBit(): number {
    if (this.bitCount === 0) {
      if (this.position >= this.data.length) {
        throw new CorruptCompressedDataError("Compressed stream ended unexpectedly.");
      }
      this.bitBuffer = this.data[this.position];
      this.position += 1;
      this.bitCount = 8;
    }

    const bit = this.bitBuffer & 1;
    this.bitBuffer >>>= 1;
    this.bitCount -= 1;

    return bit;
  }

  readBits(count: number): number {
    let value = 0;

    for (let index = 0; index < count; index += 1) {
      value |= this.readBit() << index;
    }

    return value;
  }

  alignToByte(): void {
    this.bitCount = 0;
  }

  readAlignedBytes(count: number): Uint8Array {
    if (this.position + count > this.data.length) {
      throw new CorruptCompressedDataError("Stored block runs past the end of the stream.");
    }

    const slice = this.data.subarray(this.position, this.position + count);
    this.position += count;

    return slice;
  }

  readAlignedUint16(): number {
    if (this.position + 2 > this.data.length) {
      throw new CorruptCompressedDataError("Stored block header is truncated.");
    }

    const value = this.data[this.position] | (this.data[this.position + 1] << 8);
    this.position += 2;

    return value;
  }
}

class OutputBuffer {
  private buffer: Uint8Array;
  private length = 0;

  constructor(private readonly limit: number) {
    this.buffer = new Uint8Array(Math.min(limit, 1 << 16) || 1024);
  }

  push(byte: number): void {
    this.ensure(1);
    this.buffer[this.length] = byte;
    this.length += 1;
  }

  pushBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  copyFromDistance(distance: number, count: number): void {
    if (distance > this.length) {
      throw new CorruptCompressedDataError("Back-reference points before the start of the output.");
    }

    this.ensure(count);
    let source = this.length - distance;

    for (let index = 0; index < count; index += 1) {
      this.buffer[this.length] = this.buffer[source];
      this.length += 1;
      source += 1;
    }
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }

  private ensure(extra: number): void {
    const required = this.length + extra;

    if (required > this.limit) {
      throw new CorruptCompressedDataError("Decompressed output exceeds the allowed size.");
    }

    if (required <= this.buffer.length) {
      return;
    }

    let capacity = this.buffer.length || 1024;
    while (capacity < required) {
      capacity *= 2;
    }

    const grown = new Uint8Array(Math.min(capacity, this.limit));
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }
}

function buildHuffmanTable(lengths: Uint8Array): HuffmanTable {
  const counts = new Int32Array(16);

  for (const length of lengths) {
    counts[length] += 1;
  }
  counts[0] = 0;

  const offsets = new Int32Array(16);
  for (let bits = 1; bits < 16; bits += 1) {
    offsets[bits] = offsets[bits - 1] + counts[bits - 1];
  }

  const symbols = new Int32Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    if (lengths[symbol] !== 0) {
      symbols[offsets[lengths[symbol]]] = symbol;
      offsets[lengths[symbol]] += 1;
    }
  }

  return { counts, symbols };
}

function decodeSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0;
  let first = 0;
  let index = 0;

  for (let length = 1; length < 16; length += 1) {
    code |= reader.readBit();
    const count = table.counts[length];

    if (code - first < count) {
      return table.symbols[index + (code - first)];
    }

    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }

  throw new CorruptCompressedDataError("Invalid Huffman code in compressed stream.");
}

const FIXED_LITERAL_TABLE = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);

  return buildHuffmanTable(lengths);
})();

const FIXED_DISTANCE_TABLE = buildHuffmanTable(new Uint8Array(30).fill(5));

function readDynamicTables(reader: BitReader): [HuffmanTable, HuffmanTable] {
  const literalCount = reader.readBits(5) + 257;
  const distanceCount = reader.readBits(5) + 1;
  const codeLengthCount = reader.readBits(4) + 4;

  const codeLengthLengths = new Uint8Array(19);
  for (let index = 0; index < codeLengthCount; index += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[index]] = reader.readBits(3);
  }

  const codeLengthTable = buildHuffmanTable(codeLengthLengths);
  const lengths = new Uint8Array(literalCount + distanceCount);
  let index = 0;

  while (index < lengths.length) {
    const symbol = decodeSymbol(reader, codeLengthTable);

    if (symbol < 16) {
      lengths[index] = symbol;
      index += 1;
      continue;
    }

    let repeat: number;
    let value = 0;

    if (symbol === 16) {
      if (index === 0) {
        throw new CorruptCompressedDataError("Code length repeat with no previous length.");
      }
      value = lengths[index - 1];
      repeat = reader.readBits(2) + 3;
    } else if (symbol === 17) {
      repeat = reader.readBits(3) + 3;
    } else {
      repeat = reader.readBits(7) + 11;
    }

    if (index + repeat > lengths.length) {
      throw new CorruptCompressedDataError("Code length repeat runs past the table.");
    }

    lengths.fill(value, index, index + repeat);
    index += repeat;
  }

  return [
    buildHuffmanTable(lengths.subarray(0, literalCount)),
    buildHuffmanTable(lengths.subarray(literalCount)),
  ];
}

/**
 * Decodes a raw DEFLATE stream (RFC 1951). It replaces Node's
 * `zlib.inflateRawSync` so archive and PDF reading work on Obsidian Mobile.
 * Malformed input always throws rather than returning partial output.
 */
export function inflateRaw(data: Uint8Array, options: InflateOptions = {}): Uint8Array {
  const limit = options.maxOutputLength ?? 1 << 30;
  const reader = new BitReader(data);
  const output = new OutputBuffer(limit);
  let isFinalBlock = false;

  while (!isFinalBlock) {
    isFinalBlock = reader.readBit() === 1;
    const blockType = reader.readBits(2);

    if (blockType === 0) {
      reader.alignToByte();
      const length = reader.readAlignedUint16();
      const complement = reader.readAlignedUint16();

      if ((length ^ 0xffff) !== complement) {
        throw new CorruptCompressedDataError("Stored block length check failed.");
      }

      output.pushBytes(reader.readAlignedBytes(length));
      continue;
    }

    if (blockType === 3) {
      throw new CorruptCompressedDataError("Reserved DEFLATE block type.");
    }

    const [literalTable, distanceTable] =
      blockType === 1 ? [FIXED_LITERAL_TABLE, FIXED_DISTANCE_TABLE] : readDynamicTables(reader);

    for (;;) {
      const symbol = decodeSymbol(reader, literalTable);

      if (symbol < 256) {
        output.push(symbol);
        continue;
      }

      if (symbol === 256) {
        break;
      }

      const lengthIndex = symbol - 257;
      if (lengthIndex >= LENGTH_BASE.length) {
        throw new CorruptCompressedDataError("Invalid length symbol in compressed stream.");
      }

      const length = LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
      const distanceSymbol = decodeSymbol(reader, distanceTable);

      if (distanceSymbol >= DISTANCE_BASE.length) {
        throw new CorruptCompressedDataError("Invalid distance symbol in compressed stream.");
      }

      const distance =
        DISTANCE_BASE[distanceSymbol] + reader.readBits(DISTANCE_EXTRA[distanceSymbol]);

      output.copyFromDistance(distance, length);
    }
  }

  return output.toUint8Array();
}

/**
 * Decodes a zlib-wrapped DEFLATE stream (RFC 1950), validating the two-byte
 * header before delegating to {@link inflateRaw}.
 */
export function inflateZlib(data: Uint8Array, options: InflateOptions = {}): Uint8Array {
  if (data.length < 2) {
    throw new CorruptCompressedDataError("Zlib stream is too short to contain a header.");
  }

  const compressionMethod = data[0] & 0x0f;
  if (compressionMethod !== 8) {
    throw new CorruptCompressedDataError("Unsupported zlib compression method.");
  }

  if (((data[0] << 8) | data[1]) % 31 !== 0) {
    throw new CorruptCompressedDataError("Zlib header check failed.");
  }

  if ((data[1] & 0x20) !== 0) {
    throw new CorruptCompressedDataError("Preset dictionaries are not supported.");
  }

  return inflateRaw(data.subarray(2), options);
}

const FIXED_LITERAL_LENGTHS = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);

  return lengths;
})();

const FIXED_LITERAL_CODES = buildCanonicalCodes(FIXED_LITERAL_LENGTHS);

class BitWriter {
  private readonly bytes: number[] = [];
  private bitBuffer = 0;
  private bitCount = 0;

  writeBits(value: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.bitBuffer |= ((value >>> index) & 1) << this.bitCount;
      this.bitCount += 1;

      if (this.bitCount === 8) {
        this.bytes.push(this.bitBuffer);
        this.bitBuffer = 0;
        this.bitCount = 0;
      }
    }
  }

  writeCode(code: number, length: number): void {
    for (let index = length - 1; index >= 0; index -= 1) {
      this.writeBits((code >>> index) & 1, 1);
    }
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer);
    }

    return new Uint8Array(this.bytes);
  }
}

function buildCanonicalCodes(lengths: Uint8Array): Uint16Array {
  const counts = new Int32Array(16);
  for (const length of lengths) {
    counts[length] += 1;
  }
  counts[0] = 0;

  const nextCode = new Int32Array(16);
  let code = 0;
  for (let bits = 1; bits < 16; bits += 1) {
    code = (code + counts[bits - 1]) << 1;
    nextCode[bits] = code;
  }

  const codes = new Uint16Array(lengths.length);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    if (lengths[symbol] !== 0) {
      codes[symbol] = nextCode[lengths[symbol]];
      nextCode[lengths[symbol]] += 1;
    }
  }

  return codes;
}

function lengthSymbolFor(length: number): number {
  for (let index = LENGTH_BASE.length - 1; index >= 0; index -= 1) {
    if (length >= LENGTH_BASE[index]) {
      return index;
    }
  }

  return 0;
}

function distanceSymbolFor(distance: number): number {
  for (let index = DISTANCE_BASE.length - 1; index >= 0; index -= 1) {
    if (distance >= DISTANCE_BASE[index]) {
      return index;
    }
  }

  return 0;
}

const WINDOW_SIZE = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 32;

/**
 * Compresses bytes into a raw DEFLATE stream using LZ77 matching and the fixed
 * Huffman code. It replaces Node's `zlib.deflateSync` for PNG encoding on
 * mobile, trading some ratio for a small dependency-free implementation.
 */
export function deflateRaw(data: Uint8Array): Uint8Array {
  const writer = new BitWriter();
  writer.writeBits(1, 1);
  writer.writeBits(1, 2);

  const head = new Int32Array(1 << 15).fill(-1);
  const previous = new Int32Array(data.length).fill(-1);
  let position = 0;

  while (position < data.length) {
    let matchLength = 0;
    let matchDistance = 0;

    if (position + MIN_MATCH <= data.length) {
      const key = hashAt(data, position);
      let candidate = head[key];
      let chain = 0;

      while (candidate >= 0 && chain < MAX_CHAIN) {
        const distance = position - candidate;

        if (distance > WINDOW_SIZE) {
          break;
        }

        let length = 0;
        const limit = Math.min(MAX_MATCH, data.length - position);

        while (length < limit && data[candidate + length] === data[position + length]) {
          length += 1;
        }

        if (length > matchLength) {
          matchLength = length;
          matchDistance = distance;

          if (length >= MAX_MATCH) {
            break;
          }
        }

        candidate = previous[candidate];
        chain += 1;
      }
    }

    if (matchLength >= MIN_MATCH) {
      const lengthSymbol = lengthSymbolFor(matchLength);
      const symbol = 257 + lengthSymbol;
      writer.writeCode(FIXED_LITERAL_CODES[symbol], FIXED_LITERAL_LENGTHS[symbol]);
      writer.writeBits(matchLength - LENGTH_BASE[lengthSymbol], LENGTH_EXTRA[lengthSymbol]);

      const distanceSymbol = distanceSymbolFor(matchDistance);
      writer.writeCode(distanceSymbol, 5);
      writer.writeBits(
        matchDistance - DISTANCE_BASE[distanceSymbol],
        DISTANCE_EXTRA[distanceSymbol],
      );

      for (let index = 0; index < matchLength; index += 1) {
        insertHash(data, position + index, head, previous);
      }

      position += matchLength;
      continue;
    }

    const literal = data[position];
    writer.writeCode(FIXED_LITERAL_CODES[literal], FIXED_LITERAL_LENGTHS[literal]);
    insertHash(data, position, head, previous);
    position += 1;
  }

  writer.writeCode(FIXED_LITERAL_CODES[256], FIXED_LITERAL_LENGTHS[256]);

  return writer.finish();
}

function hashAt(data: Uint8Array, position: number): number {
  return ((data[position] << 10) ^ (data[position + 1] << 5) ^ data[position + 2]) & 0x7fff;
}

function insertHash(
  data: Uint8Array,
  position: number,
  head: Int32Array,
  previous: Int32Array,
): void {
  if (position + MIN_MATCH > data.length) {
    return;
  }

  const key = hashAt(data, position);
  previous[position] = head[key];
  head[key] = position;
}

/** Wraps {@link deflateRaw} output in a zlib container with its adler32 check. */
export function deflateZlib(data: Uint8Array): Uint8Array {
  const compressed = deflateRaw(data);
  const output = new Uint8Array(2 + compressed.length + 4);

  output[0] = 0x78;
  output[1] = 0x01;
  output.set(compressed, 2);

  const checksum = adler32(data);
  const tail = 2 + compressed.length;
  output[tail] = (checksum >>> 24) & 0xff;
  output[tail + 1] = (checksum >>> 16) & 0xff;
  output[tail + 2] = (checksum >>> 8) & 0xff;
  output[tail + 3] = checksum & 0xff;

  return output;
}

/**
 * Wraps bytes as a valid zlib stream using uncompressed stored blocks. It keeps
 * PNG encoding dependency-free on mobile; the output is larger than a real
 * compressor would produce but is accepted by every zlib decoder.
 */
export function deflateZlibStored(data: Uint8Array): Uint8Array {
  const maxBlock = 0xffff;
  const blockCount = Math.max(1, Math.ceil(data.length / maxBlock));
  const output = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  let offset = 0;

  output[offset] = 0x78;
  output[offset + 1] = 0x01;
  offset += 2;

  for (let index = 0; index < blockCount; index += 1) {
    const start = index * maxBlock;
    const length = Math.min(maxBlock, data.length - start);
    const isFinal = index === blockCount - 1;

    output[offset] = isFinal ? 1 : 0;
    output[offset + 1] = length & 0xff;
    output[offset + 2] = (length >>> 8) & 0xff;
    output[offset + 3] = ~length & 0xff;
    output[offset + 4] = (~length >>> 8) & 0xff;
    offset += 5;

    output.set(data.subarray(start, start + length), offset);
    offset += length;
  }

  const checksum = adler32(data);
  output[offset] = (checksum >>> 24) & 0xff;
  output[offset + 1] = (checksum >>> 16) & 0xff;
  output[offset + 2] = (checksum >>> 8) & 0xff;
  output[offset + 3] = checksum & 0xff;

  return output;
}

function adler32(data: Uint8Array): number {
  let low = 1;
  let high = 0;

  for (const byte of data) {
    low = (low + byte) % 65521;
    high = (high + low) % 65521;
  }

  return ((high << 16) | low) >>> 0;
}
