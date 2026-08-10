import { createHash } from "crypto";
import { describe, expect, it } from "vitest";

import { decodeBase64 } from "@adapters/extractors/base64";
import { stableId } from "@adapters/extractors/common";
import { extractFb2ImageRefs } from "@adapters/extractors";

const HASH_INPUTS = [
  "",
  "a",
  "notes/Плагин.md:pdf:0:800:0",
  "日本語のテキスト",
  "emoji 🧪 mixed ascii",
  "x".repeat(55),
  "y".repeat(56),
  "z".repeat(64),
  "w".repeat(119),
  "q".repeat(1000),
];

const PNG_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x40, 0x08, 0x02, 0x00, 0x00, 0x00,
]);

describe("stableId", () => {
  it("matches Node sha256 hex digests for ascii and non-ascii inputs", () => {
    for (const input of HASH_INPUTS) {
      expect(stableId(input)).toBe(createHash("sha256").update(input).digest("hex"));
    }
  });
});

describe("decodeBase64", () => {
  it("decodes payloads containing line breaks and indentation", () => {
    const encoded = Buffer.from(PNG_HEADER).toString("base64");
    const wrapped = `\n  ${encoded.slice(0, 8)}\n  ${encoded.slice(8)}\n`;

    expect(decodeBase64(wrapped)).toEqual(PNG_HEADER);
  });

  it("returns undefined for malformed input instead of throwing", () => {
    expect(decodeBase64("A")).toBeUndefined();
    expect(decodeBase64("!!!!")).toBeUndefined();
    expect(decodeBase64("   ")).toBeUndefined();
  });
});

describe("extractFb2ImageRefs", () => {
  it("decodes wrapped base64 binaries", () => {
    const encoded = Buffer.from(PNG_HEADER).toString("base64");
    const source = `<binary id="cover" content-type="image/png">\n${encoded.slice(0, 10)}\n${encoded.slice(10)}\n</binary>`;

    expect(extractFb2ImageRefs(source, false)).toEqual([
      { locator: "binary:cover", format: "png", data: PNG_HEADER },
    ]);
  });

  it("skips binaries whose payload is not decodable", () => {
    const source = `<binary id="broken" content-type="image/png">${"A".repeat(4001)}</binary>`;

    expect(extractFb2ImageRefs(source, false)).toEqual([]);
  });

  it("keeps extracting later images after one binary fails to decode", () => {
    const encoded = Buffer.from(PNG_HEADER).toString("base64");
    const source = [
      `<binary id="broken" content-type="image/png">${"A".repeat(4001)}</binary>`,
      `<binary id="good" content-type="image/png">${encoded}</binary>`,
    ].join("\n");

    expect(extractFb2ImageRefs(source, false)).toEqual([
      { locator: "binary:good", format: "png", data: PNG_HEADER },
    ]);
  });

  it("keeps extracting when a binary carries characters outside the base64 alphabet", () => {
    const encoded = Buffer.from(PNG_HEADER).toString("base64");
    const source = [
      `<binary id="first" content-type="image/png">${encoded}</binary>`,
      `<binary id="junk" content-type="image/png">!!!!****</binary>`,
      `<binary id="last" content-type="image/png">${encoded}</binary>`,
    ].join("\n");

    expect(extractFb2ImageRefs(source, false).map((ref) => ref.locator)).toEqual([
      "binary:first",
      "binary:last",
    ]);
  });
});
