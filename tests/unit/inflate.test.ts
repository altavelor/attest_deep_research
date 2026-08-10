import { deflateRawSync, deflateSync, gzipSync, inflateRawSync, inflateSync } from "zlib";
import { randomBytes as randomCryptoBytes } from "crypto";
import { describe, expect, it } from "vitest";

import { deflateRaw, deflateZlib, inflateRaw, inflateZlib } from "@shared";

function repetitiveBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = index % 17 === 0 ? 65 : 66 + (index % 5);
  }
  return out;
}

describe("inflateRaw", () => {
  it("decodes an empty payload", () => {
    expect(Array.from(inflateRaw(new Uint8Array(deflateRawSync(Buffer.alloc(0)))))).toEqual([]);
  });

  it("matches zlib for highly compressible input using dynamic Huffman blocks", () => {
    const original = repetitiveBytes(50_000);
    const compressed = new Uint8Array(deflateRawSync(Buffer.from(original)));

    expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(original));
  });

  it("matches zlib for incompressible input, which produces stored blocks", () => {
    const original = new Uint8Array(randomCryptoBytes(70_000));
    const compressed = new Uint8Array(deflateRawSync(Buffer.from(original), { level: 0 }));

    expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(original));
  });

  it("matches zlib across every compression level", () => {
    const original = repetitiveBytes(9_000);

    for (let level = 0; level <= 9; level += 1) {
      const compressed = new Uint8Array(deflateRawSync(Buffer.from(original), { level }));
      expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(original));
    }
  });

  it("matches zlib for many randomized payloads of varying length", () => {
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const length = iteration * 37;
      const original = new Uint8Array(
        Buffer.concat([randomCryptoBytes(length), Buffer.from(repetitiveBytes(length))]),
      );
      const compressed = new Uint8Array(deflateRawSync(Buffer.from(original)));

      expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(original));
    }
  });

  it("resolves long back-references that span block boundaries", () => {
    const unit = repetitiveBytes(300);
    const original = new Uint8Array(400 * unit.length);
    for (let index = 0; index < 400; index += 1) {
      original.set(unit, index * unit.length);
    }
    const compressed = new Uint8Array(deflateRawSync(Buffer.from(original)));

    expect(Array.from(inflateRaw(compressed))).toEqual(Array.from(original));
  });

  it("throws on truncated input instead of returning partial output", () => {
    const compressed = new Uint8Array(deflateRawSync(Buffer.from(repetitiveBytes(5_000))));

    expect(() => inflateRaw(compressed.subarray(0, compressed.length - 5))).toThrow();
  });

  it("throws on a reserved block type", () => {
    expect(() => inflateRaw(new Uint8Array([0b111]))).toThrow(/Reserved/);
  });

  it("throws when a stored block length check fails", () => {
    expect(() => inflateRaw(new Uint8Array([0x01, 0x05, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5]))).toThrow(
      /length check/,
    );
  });

  it("throws on random garbage rather than looping forever", () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const garbage = new Uint8Array(randomCryptoBytes(64));
      try {
        inflateRaw(garbage, { maxOutputLength: 1 << 20 });
      } catch {
        continue;
      }
    }
  });

  it("enforces maxOutputLength against a decompression bomb", () => {
    const bomb = new Uint8Array(deflateRawSync(Buffer.alloc(1_000_000)));

    expect(() => inflateRaw(bomb, { maxOutputLength: 1000 })).toThrow(/exceeds/);
    expect(inflateRaw(bomb, { maxOutputLength: 1_000_000 }).length).toBe(1_000_000);
  });
});

describe("inflateZlib", () => {
  it("matches zlib for a wrapped stream", () => {
    const original = repetitiveBytes(20_000);
    const compressed = new Uint8Array(deflateSync(Buffer.from(original)));

    expect(Array.from(inflateZlib(compressed))).toEqual(Array.from(original));
  });

  it("rejects a stream whose header checksum is wrong", () => {
    const compressed = new Uint8Array(deflateSync(Buffer.from("hello")));
    compressed[1] = (compressed[1] + 1) & 0xff;

    expect(() => inflateZlib(compressed)).toThrow(/header check/);
  });

  it("rejects a gzip stream, which uses a different container", () => {
    expect(() => inflateZlib(new Uint8Array(gzipSync(Buffer.from("hello"))))).toThrow();
  });

  it("rejects input too short to hold a header", () => {
    expect(() => inflateZlib(new Uint8Array([0x78]))).toThrow(/too short/);
  });

  it("rejects a stream whose adler32 trailer does not match the data", () => {
    const compressed = new Uint8Array(deflateSync(Buffer.from(repetitiveBytes(5_000))));
    compressed[compressed.length - 1] ^= 0xff;

    expect(() => inflateZlib(compressed)).toThrow(/checksum/);
  });

  it("rejects a stream whose payload was tampered with under a stale checksum", () => {
    const original = repetitiveBytes(5_000);
    const compressed = new Uint8Array(deflateSync(Buffer.from(original), { level: 0 }));
    const storedByte = compressed.findIndex((_, index) => index > 10);
    compressed[storedByte] ^= 0x01;

    expect(() => inflateZlib(compressed)).toThrow(/checksum/);
  });

  it("rejects a stream truncated so the checksum is missing", () => {
    const compressed = new Uint8Array(deflateSync(Buffer.from(repetitiveBytes(1_000))));

    expect(() => inflateZlib(compressed.subarray(0, compressed.length - 2))).toThrow();
  });

  it("accepts a valid stream, so the checksum check is not vacuous", () => {
    const original = repetitiveBytes(5_000);

    expect(Array.from(inflateZlib(new Uint8Array(deflateSync(Buffer.from(original)))))).toEqual(
      Array.from(original),
    );
  });
});

describe("DEFLATE bit order matches the reference implementation", () => {
  it("decodes dynamic-Huffman output from zlib, whose codes are not palindromic", () => {
    const text = Buffer.from(
      "the quick brown fox jumps over the lazy dog ".repeat(2000) +
        "ZZZQQQXXX rare symbols skew the code lengths ".repeat(37),
      "utf8",
    );
    const compressed = new Uint8Array(deflateRawSync(text, { level: 9 }));

    expect(Buffer.from(inflateRaw(compressed)).toString("utf8")).toBe(text.toString("utf8"));
  });

  it("decodes fixed-Huffman output from zlib", () => {
    const small = Buffer.from("abcdefghijklmnopqrstuvwxyz0123456789", "utf8");
    const compressed = new Uint8Array(deflateRawSync(small, { level: 1 }));

    expect(Buffer.from(inflateRaw(compressed)).toString("utf8")).toBe(small.toString("utf8"));
  });

  it("round-trips both directions against zlib across many payloads", () => {
    for (let index = 0; index < 60; index += 1) {
      const source = new Uint8Array(
        Buffer.concat([randomCryptoBytes(index * 11), Buffer.from("ab".repeat(index * 3), "utf8")]),
      );

      expect(Array.from(new Uint8Array(inflateRawSync(Buffer.from(deflateRaw(source)))))).toEqual(
        Array.from(source),
      );
      expect(Array.from(inflateRaw(new Uint8Array(deflateRawSync(Buffer.from(source)))))).toEqual(
        Array.from(source),
      );
    }
  });
});

describe("deflateRaw", () => {
  it("produces a stream Node's zlib can inflate", () => {
    for (const length of [0, 1, 2, 3, 100, 1000, 65_536, 300_000]) {
      const original = repetitiveBytes(length);

      expect(Array.from(new Uint8Array(inflateRawSync(Buffer.from(deflateRaw(original)))))).toEqual(
        Array.from(original),
      );
    }
  });

  it("round-trips incompressible data", () => {
    const original = new Uint8Array(randomCryptoBytes(50_000));

    expect(Array.from(new Uint8Array(inflateRawSync(Buffer.from(deflateRaw(original)))))).toEqual(
      Array.from(original),
    );
  });

  it("round-trips data with long repeats through its own decoder", () => {
    const unit = repetitiveBytes(500);
    const original = new Uint8Array(200 * unit.length);
    for (let index = 0; index < 200; index += 1) {
      original.set(unit, index * unit.length);
    }

    expect(Array.from(inflateRaw(deflateRaw(original)))).toEqual(Array.from(original));
  });

  it("compresses repetitive input to a small fraction of its size", () => {
    const original = repetitiveBytes(200_000);

    expect(deflateRaw(original).length).toBeLessThan(original.length / 10);
  });

  it("round-trips every byte value and boundary-length input", () => {
    for (let length = 0; length <= 300; length += 1) {
      const original = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        original[index] = (index * 7) % 256;
      }

      expect(Array.from(inflateRaw(deflateRaw(original)))).toEqual(Array.from(original));
    }
  });
});

describe("deflateZlib", () => {
  it("produces a stream Node's zlib can inflate", () => {
    const original = repetitiveBytes(100_000);

    expect(Array.from(new Uint8Array(inflateSync(Buffer.from(deflateZlib(original)))))).toEqual(
      Array.from(original),
    );
  });
});
