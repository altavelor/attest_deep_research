import { describe, expect, it } from "vitest";

import { hasDecodableDimensions, readImageDimensions } from "@core/media";

function bytes(length: number, values: Record<number, number>): Uint8Array {
  const data = new Uint8Array(length);
  for (const [offset, value] of Object.entries(values)) data[Number(offset)] = value;
  return data;
}

describe("image header dimensions", () => {
  it("reads dimensions from PNG and GIF headers", () => {
    const png = bytes(24, {
      0: 0x89,
      1: 0x50,
      2: 0x4e,
      3: 0x47,
      4: 0x0d,
      5: 0x0a,
      6: 0x1a,
      7: 0x0a,
      19: 80,
      23: 60,
    });
    const gif = bytes(10, { 0: 0x47, 1: 0x49, 2: 0x46, 6: 40, 8: 30 });

    expect(readImageDimensions(png, "png")).toEqual({ width: 80, height: 60 });
    expect(readImageDimensions(gif, "gif")).toEqual({ width: 40, height: 30 });
  });

  it("walks JPEG markers to the first frame header", () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x0b, 8, 0, 32, 0, 48,
    ]);

    expect(readImageDimensions(jpeg, "jpeg")).toEqual({ width: 48, height: 32 });
  });

  it("reads extended WebP dimensions and rejects tiny or malformed images", () => {
    const webp = bytes(30, {
      0: 0x52,
      1: 0x49,
      2: 0x46,
      3: 0x46,
      8: 0x57,
      9: 0x45,
      10: 0x42,
      11: 0x50,
      12: 0x56,
      13: 0x50,
      14: 0x38,
      15: 0x58,
      24: 31,
      27: 23,
    });

    expect(readImageDimensions(webp, "webp")).toEqual({ width: 32, height: 24 });
    expect(hasDecodableDimensions(webp, "webp")).toBe(true);
    expect(hasDecodableDimensions(bytes(24, { 0: 0x89 }), "png")).toBe(false);
    expect(hasDecodableDimensions(bytes(24, { 0: 0x89, 1: 0x50, 2: 0x4e, 3: 0x47 }), "png")).toBe(
      false,
    );
  });
});
