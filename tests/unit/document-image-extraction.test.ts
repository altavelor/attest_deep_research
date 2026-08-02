import { deflateRawSync } from "zlib";
import { describe, expect, it } from "vitest";

import {
  documentImageCandidates,
  extractDocumentImages,
  supportsDocumentImages,
} from "@adapters/extractors";
import { extractPageImages } from "@adapters/web";

function zip(entries: Record<string, Buffer | string>): ArrayBuffer {
  const files = Object.entries(entries).map(([name, content]) => {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    return { name: Buffer.from(name, "utf8"), data, compressed: deflateRawSync(data) };
  });

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(file.compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(file.name.length, 26);
    locals.push(local, file.name, file.compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(file.compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(file.name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, file.name);

    offset += 30 + file.name.length + file.compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const zipped = Buffer.concat([Buffer.concat(locals), centralBuffer, eocd]);
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

function png(width: number, height: number): Buffer {
  const header = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const size = Buffer.alloc(8);
  size.writeUInt32BE(width, 0);
  size.writeUInt32BE(height, 4);
  return Buffer.concat([header, size, Buffer.alloc(4, 0)]);
}

function jpeg(width: number, height: number): Buffer {
  const frame = Buffer.alloc(11);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(9, 2);
  frame.writeUInt8(8, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from("ffd8", "hex"), frame, Buffer.alloc(32, 0x11)]);
}

const pngBytes = png(64, 64);
const jpegBytes = jpeg(64, 64);

describe("markdown and text image extraction", () => {
  it("extracts wiki embeds and vault-relative markdown links", () => {
    const refs = extractDocumentImages({
      path: "notes/topic.md",
      data: [
        "![[assets/diagram.png|Diagram of the flow]]",
        "![A photo](assets/photo.jpg)",
        "![Remote](https://example.com/remote.png)",
        "![Escape](../../secrets/leak.png)",
        "![Vector](assets/logo.svg)",
      ].join("\n\n"),
    });
    expect(refs.map((ref) => ref.linkedPath)).toEqual([
      "assets/diagram.png",
      "notes/assets/photo.jpg",
    ]);
    expect(refs[0]!.alt).toBe("Diagram of the flow");
  });

  it("resolves markdown links relative to the containing document", () => {
    const refs = extractDocumentImages({
      path: "docs/note.md",
      data: "![](images/photo.png)",
    });
    expect(refs.map((ref) => ref.linkedPath)).toEqual(["docs/images/photo.png"]);
    expect(refs[0]!.locator).toBe("link:docs/images/photo.png");
  });

  it("prefers the host link resolver over relative resolution", () => {
    const refs = extractDocumentImages({
      path: "docs/note.md",
      data: "![[photo.png]]",
      resolveLinkedPath: (target, fromPath) =>
        target === "photo.png" && fromPath === "docs/note.md" ? "attachments/photo.png" : undefined,
    });
    expect(refs.map((ref) => ref.linkedPath)).toEqual(["attachments/photo.png"]);
  });

  it("returns no images for plain text", () => {
    expect(supportsDocumentImages("notes/plain.txt")).toBe(true);
    expect(extractDocumentImages({ path: "notes/plain.txt", data: "![x](a.png)" })).toEqual([]);
  });
});

describe("docx image extraction", () => {
  it("extracts word/media entries with relationship alt text", () => {
    const data = zip({
      "word/document.xml":
        '<w:document><w:p><w:drawing><wp:docPr id="1" name="Picture 1" descr="Sales chart"/><a:blip r:embed="rId7"/></w:drawing></w:p></w:document>',
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Id="rId7" Target="media/image1.png"/></Relationships>',
      "word/media/image1.png": pngBytes,
    });
    const refs = extractDocumentImages({ path: "docs/report.docx", data });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      locator: "zip:word/media/image1.png",
      format: "png",
      alt: "Sales chart",
    });
    expect(refs[0]!.data).toBeInstanceOf(Uint8Array);
  });

  it("omits bytes in metadata-only mode", () => {
    const data = zip({ "word/media/image1.png": pngBytes });
    const refs = extractDocumentImages({ path: "docs/r.docx", data, metadataOnly: true });
    expect(refs[0]!.data).toBeUndefined();
  });

  it("rejects members whose decoded dimensions exceed the limit", () => {
    const data = zip({ "word/media/bomb.png": png(60_000, 60_000) });
    expect(extractDocumentImages({ path: "docs/bomb.docx", data })).toEqual([]);
  });

  it("rejects members whose header declares no readable size", () => {
    const data = zip({ "word/media/image1.png": Buffer.alloc(64, 0x00) });
    expect(extractDocumentImages({ path: "docs/opaque.docx", data })).toEqual([]);
  });

  it("degrades to no images for a corrupt archive", () => {
    expect(extractDocumentImages({ path: "docs/broken.docx", data: "not a zip" })).toEqual([]);
  });
});

describe("epub image extraction", () => {
  it("extracts manifest images referenced from the spine", () => {
    const data = zip({
      "META-INF/container.xml": '<container><rootfile full-path="OEBPS/content.opf"/></container>',
      "OEBPS/content.opf":
        '<package><manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="i1" href="images/cover.png" media-type="image/png"/>' +
        '<item id="i2" href="images/unused.png" media-type="image/png"/>' +
        '</manifest><spine><itemref idref="c1"/></spine></package>',
      "OEBPS/chapter1.xhtml": '<html><body><img src="images/cover.png" alt="Cover"/></body></html>',
      "OEBPS/images/cover.png": pngBytes,
      "OEBPS/images/unused.png": pngBytes,
    });
    const refs = extractDocumentImages({ path: "books/story.epub", data });
    expect(refs.map((ref) => ref.locator)).toEqual(["zip:OEBPS/images/cover.png"]);
  });
});

describe("fb2 image extraction", () => {
  it("decodes referenced base64 binaries", () => {
    const source = `<FictionBook><body><p>text</p></body><binary id="cover.jpg" content-type="image/jpeg">${jpegBytes.toString("base64")}</binary><binary id="bad.svg" content-type="image/svg+xml">AAAA</binary></FictionBook>`;
    const refs = extractDocumentImages({ path: "books/tale.fb2", data: source });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ locator: "binary:cover.jpg", format: "jpeg" });
    expect(refs[0]!.data!.length).toBe(jpegBytes.length);
  });
});

describe("pdf image extraction", () => {
  it("extracts DCTDecode rasters with a page-and-ordinal locator", () => {
    const pdf = Buffer.concat([
      Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Type /Page /Resources << /XObject << /Im0 2 0 R >> >> >>\nendobj\n",
        "latin1",
      ),
      Buffer.from(
        "2 0 obj\n<< /Subtype /Image /Filter /DCTDecode /Width 800 /Height 600 /Length 68 >>\nstream\n",
        "latin1",
      ),
      jpegBytes,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    ]);
    const refs = extractDocumentImages({
      path: "docs/paper.pdf",
      data: pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ locator: "page:1:0", format: "jpeg", width: 800, height: 600 });
  });

  it("skips tiny rasters", () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n2 0 obj\n<< /Subtype /Image /Filter /DCTDecode /Width 1 /Height 1 >>\nstream\nxx\nendstream\nendobj\n",
      "latin1",
    );
    expect(
      extractDocumentImages({
        path: "docs/tiny.pdf",
        data: pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer,
      }),
    ).toEqual([]);
  });
});

describe("candidate mapping", () => {
  it("attributes embedded images to the document and linked ones to the file", () => {
    const candidates = documentImageCandidates("docs/report.docx", [
      { locator: "zip:word/media/image1.png", format: "png", alt: "Sales chart" },
      { locator: "link:assets/photo.jpg", format: "jpeg", linkedPath: "assets/photo.jpg" },
    ]);
    expect(candidates[0]).toMatchObject({
      origin: "document",
      vaultSource: { documentPath: "docs/report.docx", locator: "zip:word/media/image1.png" },
      sourceLabel: "report.docx",
      alt: "Sales chart",
    });
    expect(candidates[1]!.vaultSource).toEqual({
      documentPath: "assets/photo.jpg",
      locator: "file",
    });
  });
});

describe("fetched page image extraction", () => {
  const html = `
    <html><head><title>Solar power basics</title>
    <link rel="canonical" href="https://example.com/solar"/>
    <meta property="og:image" content="/img/hero.jpg"/>
    <meta name="twitter:image" content="https://example.com/img/social.png"/>
    </head><body>
    <img src="img/panel.webp" alt="A solar panel" width="900" height="600"/>
    <img src="img/pixel.gif" width="1" height="1"/>
    <img src="data:image/png;base64,AAA"/>
    <img src="http://example.com/insecure.png"/>
    <img src="/img/hero.jpg"/>
    </body></html>`;

  it("prefers social previews and keeps page attribution", () => {
    const candidates = extractPageImages({ html, baseUrl: "https://example.com/articles/solar" });
    expect(candidates.map((candidate) => candidate.fullUrl)).toEqual([
      "https://example.com/img/hero.jpg",
      "https://example.com/img/social.png",
      "https://example.com/articles/img/panel.webp",
    ]);
    expect(candidates[0]).toMatchObject({
      origin: "page",
      sourceUrl: "https://example.com/solar",
      sourceLabel: "Solar power basics",
    });
    expect(candidates.every((candidate) => candidate.licensed !== true)).toBe(true);
  });

  it("bounds the candidate count", () => {
    const many = Array.from({ length: 30 }, (_, index) => `<img src="/i/${index}.png"/>`).join("");
    expect(extractPageImages({ html: many, baseUrl: "https://example.com/" })).toHaveLength(8);
  });
});
