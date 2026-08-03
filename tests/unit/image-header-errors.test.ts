import { hasDecodableDimensions, readImageDimensions } from "@core/media";
import type { EligibleImageFormat } from "@core/media";

function png(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(data.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
}

function gif(width: number, height: number): Uint8Array {
  const data = new Uint8Array(10);
  data.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const view = new DataView(data.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return data;
}

function jpegSegments(segments: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat()]);
}

function jpegFrame(marker: number, width: number, height: number): number[] {
  return [0xff, marker, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff];
}

function webp(chunk: string, payload: number[]): Uint8Array {
  const header = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
  const chunkBytes = [...chunk].map((character) => character.charCodeAt(0));
  return Uint8Array.from([...header, ...chunkBytes, ...payload]);
}

function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  const typeBytes = [...type].map((character) => character.charCodeAt(0));
  return [
    (size >> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    ...typeBytes,
    ...payload,
  ];
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ispeBox(width: number, height: number): number[] {
  return box("ispe", [0, 0, 0, 0, ...be32(width), ...be32(height)]);
}

function avif(inner: number[]): Uint8Array {
  const ftyp = box("ftyp", [0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]);
  return Uint8Array.from([...ftyp, ...inner]);
}

describe("readImageDimensions rejects malformed headers", () => {
  it("reads the declared size of well-formed headers", () => {
    expect(readImageDimensions(png(120, 80), "png")).toEqual({ width: 120, height: 80 });
    expect(readImageDimensions(gif(64, 48), "gif")).toEqual({ width: 64, height: 48 });
    expect(readImageDimensions(jpegSegments([jpegFrame(0xc0, 200, 100)]), "jpeg")).toEqual({
      width: 200,
      height: 100,
    });
  });

  it("returns undefined for an unsupported format tag", () => {
    expect(readImageDimensions(png(120, 80), "svg" as EligibleImageFormat)).toBeUndefined();
  });

  it("returns undefined when a header is truncated before its size fields", () => {
    expect(readImageDimensions(png(120, 80).slice(0, 23), "png")).toBeUndefined();
    expect(readImageDimensions(gif(64, 48).slice(0, 9), "gif")).toBeUndefined();
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff]), "jpeg")).toBeUndefined();
    expect(readImageDimensions(webp("VP8L", [0, 0]).slice(0, 15), "webp")).toBeUndefined();
    expect(readImageDimensions(avif([]).slice(0, 15), "avif")).toBeUndefined();
  });

  it("returns undefined when the container is mislabelled as another format", () => {
    expect(readImageDimensions(png(120, 80), "gif")).toBeUndefined();
    expect(readImageDimensions(gif(64, 48), "png")).toBeUndefined();
    expect(readImageDimensions(png(120, 80), "jpeg")).toBeUndefined();
    expect(readImageDimensions(png(120, 80), "webp")).toBeUndefined();
    expect(readImageDimensions(png(120, 80), "avif")).toBeUndefined();
  });

  it("does not read a size out of a long buffer whose signature belongs to another format", () => {
    const longGif = new Uint8Array(48).fill(0x11);
    longGif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    new DataView(longGif.buffer).setUint16(6, 64, true);
    new DataView(longGif.buffer).setUint16(8, 48, true);

    expect(readImageDimensions(longGif, "gif")).toEqual({ width: 64, height: 48 });
    expect(readImageDimensions(longGif, "png")).toBeUndefined();
    expect(readImageDimensions(longGif, "avif")).toBeUndefined();
    expect(readImageDimensions(longGif, "webp")).toBeUndefined();
  });

  it("rejects a RIFF container that is not WEBP and an unknown WEBP chunk", () => {
    const notWebp = webp("VP8 ", new Array(20).fill(0));
    notWebp[9] = 0x41;
    expect(readImageDimensions(notWebp, "webp")).toBeUndefined();
    expect(readImageDimensions(webp("XXXX", new Array(20).fill(0)), "webp")).toBeUndefined();
  });

  it("returns undefined when a declared dimension is zero", () => {
    expect(readImageDimensions(png(0, 80), "png")).toBeUndefined();
    expect(readImageDimensions(png(120, 0), "png")).toBeUndefined();
    expect(readImageDimensions(gif(0, 48), "gif")).toBeUndefined();
    expect(readImageDimensions(jpegSegments([jpegFrame(0xc0, 0, 100)]), "jpeg")).toBeUndefined();
    expect(readImageDimensions(avif(ispeBox(0, 100)), "avif")).toBeUndefined();
  });

  it("stops at JPEG entropy-coded data and invalid segment lengths", () => {
    expect(readImageDimensions(jpegSegments([[0xff, 0xda, 0, 4, 0, 0]]), "jpeg")).toBeUndefined();
    expect(readImageDimensions(jpegSegments([[0xff, 0xd9, 0, 0]]), "jpeg")).toBeUndefined();
    expect(
      readImageDimensions(jpegSegments([[0xff, 0xe0, 0x00, 0x01, 0x00, 0x00]]), "jpeg"),
    ).toBeUndefined();
  });

  it("skips padding, restart markers and non-frame segments before the frame header", () => {
    const dimensions = readImageDimensions(
      jpegSegments([
        [0x00, 0x00],
        [0xff, 0xd0],
        [0xff, 0x01],
        [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00],
        jpegFrame(0xc2, 300, 150),
      ]),
      "jpeg",
    );

    expect(dimensions).toEqual({ width: 300, height: 150 });
  });

  it("reads lossless and extended WEBP layouts", () => {
    const vp8l = webp("VP8L", [
      ...new Array(5).fill(0),
      0x3f,
      0x00,
      0x00,
      0x00,
      ...new Array(4).fill(0),
    ]);
    expect(readImageDimensions(vp8l, "webp")).toEqual({ width: 64, height: 1 });

    const vp8x = webp("VP8X", [
      ...new Array(8).fill(0),
      0x3f,
      0x00,
      0x00,
      0x1f,
      0x00,
      0x00,
      ...new Array(4).fill(0),
    ]);
    expect(readImageDimensions(vp8x, "webp")).toEqual({ width: 64, height: 32 });

    expect(readImageDimensions(webp("VP8X", new Array(13).fill(0)), "webp")).toBeUndefined();
  });

  it("finds the ispe box nested inside meta, iprp and ipco", () => {
    const nested = box("meta", [
      ...new Array(4).fill(0),
      ...box("iprp", box("ipco", ispeBox(640, 480))),
    ]);

    expect(readImageDimensions(avif(nested), "avif")).toEqual({ width: 640, height: 480 });
  });

  it("stops scanning an ISOBMFF box whose declared size overflows the file", () => {
    const overflowing = [...be32(4096), ...[..."meta"].map((c) => c.charCodeAt(0)), 0, 0, 0, 0];

    expect(readImageDimensions(avif(overflowing), "avif")).toBeUndefined();
  });

  it("treats undecodable and out-of-bounds sizes as not displayable", () => {
    expect(hasDecodableDimensions(png(120, 80), "png")).toBe(true);
    expect(hasDecodableDimensions(png(120, 80).slice(0, 20), "png")).toBe(false);
    expect(hasDecodableDimensions(png(4, 4), "png")).toBe(false);
    expect(hasDecodableDimensions(png(60_000, 60_000), "png")).toBe(false);
  });
});
