const LATIN1_CHUNK_SIZE = 8192;

export function readUint16LE(bytes: Uint8Array, offset: number): number {
  return view(bytes).getUint16(offset, true);
}

export function readUint32LE(bytes: Uint8Array, offset: number): number {
  return view(bytes).getUint32(offset, true);
}

export function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  view(bytes).setUint32(offset, value >>> 0, false);
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function decodeUtf8(bytes: Uint8Array, start = 0, end = bytes.length): string {
  return new TextDecoder().decode(bytes.subarray(start, end));
}

/** Decodes bytes as ISO-8859-1, where every byte maps to the code point of the same value. */
export function decodeLatin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  const from = Math.max(0, Math.min(start, bytes.length));
  const to = Math.max(from, Math.min(end, bytes.length));
  let text = "";

  for (let offset = from; offset < to; offset += LATIN1_CHUNK_SIZE) {
    text += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + LATIN1_CHUNK_SIZE, to)),
    );
  }

  return text;
}

/** Finds the first offset at or after `from` where the ASCII `needle` occurs. */
export function indexOfAscii(bytes: Uint8Array, needle: string, from = 0): number {
  const pattern = new Uint8Array(needle.length);
  for (let index = 0; index < needle.length; index += 1) {
    pattern[index] = needle.charCodeAt(index) & 0xff;
  }

  const limit = bytes.length - pattern.length;
  for (let start = Math.max(0, from); start <= limit; start += 1) {
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (bytes[start + index] !== pattern[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }

  return -1;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
