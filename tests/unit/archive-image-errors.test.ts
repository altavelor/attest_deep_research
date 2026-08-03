import { deflateRawSync } from "zlib";

import { extractDocumentImages } from "@adapters/extractors";

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

function truncate(archive: ArrayBuffer, bytes: number): ArrayBuffer {
  return archive.slice(0, archive.byteLength - bytes);
}

function png(width: number, height: number, padding = 4): Buffer {
  const header = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const size = Buffer.alloc(8);
  size.writeUInt32BE(width, 0);
  size.writeUInt32BE(height, 4);
  return Buffer.concat([header, size, Buffer.alloc(padding, 0)]);
}

const pngBytes = png(64, 64);

function epub(entries: Record<string, Buffer | string>): ArrayBuffer {
  return zip({
    "META-INF/container.xml": '<container><rootfile full-path="OEBPS/content.opf"/></container>',
    ...entries,
  });
}

function locators(path: string, data: ArrayBuffer | string): string[] {
  return extractDocumentImages({ path, data }).map((ref) => ref.locator);
}

describe("docx image extraction rejects untrusted archive entries", () => {
  it("yields nothing for a truncated archive", () => {
    const archive = zip({ "word/media/image1.png": pngBytes });

    expect(locators("docs/report.docx", truncate(archive, 4))).toEqual([]);
    expect(locators("docs/report.docx", new ArrayBuffer(0))).toEqual([]);
  });

  it("skips entries whose names escape the archive root", () => {
    const archive = zip({
      "word/media/../../../etc/passwd.png": pngBytes,
      "word/media//hidden.png": pngBytes,
      "word/media/nested\\image.png": pngBytes,
      "word/media/safe.png": pngBytes,
    });

    expect(locators("docs/report.docx", archive)).toEqual(["zip:word/media/safe.png"]);
  });

  it("skips an entry larger than the per-image byte limit", () => {
    const oversized = Buffer.concat([png(64, 64, 0), Buffer.alloc(9 * 1024 * 1024, 0)]);
    const archive = zip({
      "word/media/huge.png": oversized,
      "word/media/small.png": pngBytes,
    });

    expect(locators("docs/report.docx", archive)).toEqual(["zip:word/media/small.png"]);
  });

  it("skips empty entries and entries whose extension is not an eligible image", () => {
    const archive = zip({
      "word/media/empty.png": Buffer.alloc(0),
      "word/media/notes.txt": "plain text",
      "word/media/vector.svg": "<svg/>",
      "word/media/image1.png": pngBytes,
    });

    expect(locators("docs/report.docx", archive)).toEqual(["zip:word/media/image1.png"]);
  });

  it("stops after the per-source candidate limit", () => {
    const entries: Record<string, Buffer> = {};
    for (let index = 0; index < 12; index += 1) {
      entries[`word/media/image${String(index).padStart(2, "0")}.png`] = pngBytes;
    }

    expect(locators("docs/many.docx", zip(entries))).toHaveLength(8);
  });

  it("stops once the total decoded byte budget is exceeded", () => {
    const entries: Record<string, Buffer> = {};
    for (let index = 0; index < 6; index += 1) {
      entries[`word/media/image${index}.png`] = Buffer.concat([
        png(64, 64, 0),
        Buffer.alloc(7 * 1024 * 1024, index + 1),
      ]);
    }

    const refs = locators("docs/heavy.docx", zip(entries));

    expect(refs.length).toBeGreaterThan(0);
    expect(refs.length).toBeLessThan(6);
  });

  it("keeps the image but drops alt text when the drawing metadata is unusable", () => {
    const archive = zip({
      "word/document.xml":
        "<w:document><w:p><w:drawing><a:blip/></w:drawing>" +
        '<w:drawing><a:blip r:embed="rMissing"/></w:drawing>' +
        '<w:drawing><wp:docPr id="3" descr="  "/><a:blip r:embed="rId7"/></w:drawing>' +
        "</w:p></w:document>",
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Id="rId7" Target="media/image1.png"/>' +
        '<Relationship Target="media/orphan.png"/></Relationships>',
      "word/media/image1.png": pngBytes,
    });

    const refs = extractDocumentImages({ path: "docs/report.docx", data: archive });

    expect(refs).toHaveLength(1);
    expect(refs[0]!.alt).toBeUndefined();
  });

  it("falls back to the drawing name when no description is authored", () => {
    const archive = zip({
      "word/document.xml":
        '<w:document><w:drawing><wp:docPr id="1" name="Picture &amp; chart"/>' +
        '<a:blip r:embed="rId1"/></w:drawing></w:document>',
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="media/image1.png"/></Relationships>',
      "word/media/image1.png": pngBytes,
    });

    expect(extractDocumentImages({ path: "docs/report.docx", data: archive })[0]!.alt).toBe(
      "Picture & chart",
    );
  });

  it("ignores relationship metadata when the document body is missing", () => {
    const archive = zip({
      "word/_rels/document.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="media/image1.png"/></Relationships>',
      "word/media/image1.png": pngBytes,
    });

    const refs = extractDocumentImages({ path: "docs/report.docx", data: archive });

    expect(refs.map((ref) => ref.locator)).toEqual(["zip:word/media/image1.png"]);
    expect(refs[0]!.alt).toBeUndefined();
  });

  it("does not extract images for a path it does not support", () => {
    expect(locators("docs/report.doc", zip({ "word/media/image1.png": pngBytes }))).toEqual([]);
  });
});

describe("epub image extraction rejects unusable packages", () => {
  it("yields nothing when the container or package cannot be read", () => {
    expect(locators("books/a.epub", zip({ "OEBPS/images/cover.png": pngBytes }))).toEqual([]);
    expect(
      locators("books/b.epub", zip({ "META-INF/container.xml": "<container></container>" })),
    ).toEqual([]);
    expect(locators("books/c.epub", epub({ "OEBPS/images/cover.png": pngBytes }))).toEqual([]);
  });

  it("skips a manifest image whose archive entry is unreadable", () => {
    const archive = epub({
      "OEBPS/content.opf":
        '<package><manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="i1" href="images/missing.png" media-type="image/png"/>' +
        '<item href="images/nameless.png" media-type="image/png"/>' +
        '</manifest><spine><itemref idref="c1"/><itemref idref="unknown"/></spine></package>',
      "OEBPS/chapter1.xhtml": '<html><body><img src="images/missing.png"/></body></html>',
    });

    expect(locators("books/broken.epub", archive)).toEqual([]);
  });

  it("skips manifest entries whose media type is not an eligible image", () => {
    const archive = epub({
      "OEBPS/content.opf":
        '<package><manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="i1" href="images/cover.svg" media-type="image/svg+xml"/>' +
        '<item id="i2" href="images/cover.png" media-type="image/png"/>' +
        '</manifest><spine><itemref idref="c1"/></spine></package>',
      "OEBPS/chapter1.xhtml":
        '<html><body><image xlink:href="images/cover.svg"/><img src="images/cover.png?v=2"/></body></html>',
      "OEBPS/images/cover.svg": "<svg/>",
      "OEBPS/images/cover.png": pngBytes,
    });

    expect(locators("books/story.epub", archive)).toEqual(["zip:OEBPS/images/cover.png"]);
  });

  it("resolves parent-relative and absolute references without escaping the archive", () => {
    const archive = zip({
      "META-INF/container.xml":
        '<container><rootfile full-path="OEBPS/text/content.opf"/></container>',
      "OEBPS/text/content.opf":
        '<package><manifest><item id="c1" href="../pages/chapter1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="i1" href="../images/cover.png" media-type="image/png"/>' +
        '</manifest><spine><itemref idref="c1"/></spine></package>',
      "OEBPS/pages/chapter1.xhtml":
        '<html><body><img href="/OEBPS/images/cover.png"/></body></html>',
      "OEBPS/images/cover.png": pngBytes,
    });

    expect(locators("books/nested.epub", archive)).toEqual(["zip:OEBPS/images/cover.png"]);
  });

  it("yields nothing for a truncated epub archive", () => {
    const archive = epub({
      "OEBPS/content.opf":
        '<package><manifest><item id="i1" href="images/cover.png" media-type="image/png"/>' +
        "</manifest><spine/></package>",
      "OEBPS/images/cover.png": pngBytes,
    });

    expect(locators("books/truncated.epub", truncate(archive, 8))).toEqual([]);
  });
});
