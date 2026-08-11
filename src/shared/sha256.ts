const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const HEX = "0123456789abcdef";

/**
 * Synchronous SHA-256 over UTF-8 text or raw bytes, returning a lowercase hex
 * digest. It replaces Node's `crypto.createHash` so the indexing pipeline keeps
 * its synchronous signatures while running on Obsidian Mobile, where Node
 * built-ins are unavailable and `crypto.subtle` is async-only.
 */
export function sha256Hex(input: string | Uint8Array | ArrayBuffer): string {
  return digestToHex(sha256Bytes(input));
}

export function sha256Bytes(input: string | Uint8Array | ArrayBuffer): Uint8Array {
  const message = toBytes(input);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLength = message.length * 8;
  const paddedLength = (((message.length + 8) >> 6) << 6) + 64;
  const block = new Uint32Array(16);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let word = 0; word < 16; word += 1) {
      const base = offset + word * 4;
      block[word] =
        (paddedByte(message, base, paddedLength, bitLength) << 24) |
        (paddedByte(message, base + 1, paddedLength, bitLength) << 16) |
        (paddedByte(message, base + 2, paddedLength, bitLength) << 8) |
        paddedByte(message, base + 3, paddedLength, bitLength);
    }

    compress(state, block, schedule);
  }

  const digest = new Uint8Array(32);
  for (let index = 0; index < 8; index += 1) {
    const value = state[index];
    digest[index * 4] = (value >>> 24) & 0xff;
    digest[index * 4 + 1] = (value >>> 16) & 0xff;
    digest[index * 4 + 2] = (value >>> 8) & 0xff;
    digest[index * 4 + 3] = value & 0xff;
  }

  return digest;
}

function compress(state: Uint32Array, block: Uint32Array, schedule: Uint32Array): void {
  for (let index = 0; index < 16; index += 1) {
    schedule[index] = block[index];
  }

  for (let index = 16; index < 64; index += 1) {
    const previous = schedule[index - 15];
    const ahead = schedule[index - 2];
    const s0 =
      ((previous >>> 7) | (previous << 25)) ^
      ((previous >>> 18) | (previous << 14)) ^
      (previous >>> 3);
    const s1 = ((ahead >>> 17) | (ahead << 15)) ^ ((ahead >>> 19) | (ahead << 13)) ^ (ahead >>> 10);
    schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) | 0;
  }

  let [a, b, c, d, e, f, g, h] = state;

  for (let index = 0; index < 64; index += 1) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const choose = (e & f) ^ (~e & g);
    const temp1 = (h + s1 + choose + ROUND_CONSTANTS[index] + schedule[index]) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (s0 + majority) | 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) | 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) | 0;
  }

  state[0] = (state[0] + a) | 0;
  state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0;
  state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0;
  state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0;
  state[7] = (state[7] + h) | 0;
}

function paddedByte(
  message: Uint8Array,
  index: number,
  paddedLength: number,
  bitLength: number,
): number {
  if (index < message.length) {
    return message[index];
  }

  if (index === message.length) {
    return 0x80;
  }

  if (index < paddedLength - 8) {
    return 0;
  }

  const shift = (paddedLength - 1 - index) * 8;

  return Math.floor(bitLength / 2 ** shift) % 256;
}

function digestToHex(digest: Uint8Array): string {
  let hex = "";

  for (const byte of digest) {
    hex += HEX[byte >>> 4] + HEX[byte & 0x0f];
  }

  return hex;
}

function toBytes(input: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }

  return input instanceof Uint8Array ? input : new Uint8Array(input);
}
