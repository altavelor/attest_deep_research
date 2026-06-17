import { readFileSync } from "fs";
import { join } from "path";

import { PdfExtractor, PdfPageTextParser } from "../../src/extractors/PdfExtractor";
import { PdfTextCache } from "../../src/extractors/PdfTextCache";

const fixturePath = join(__dirname, "../fixtures/pdf/simple-text.pdf");
const plainTextFixturePath = join(__dirname, "../fixtures/pdf/plain-text.pdf");
const smallPdfBookFixturePath = join(__dirname, "../fixtures/pdf/small-pdf-book.pdf");

describe("PdfExtractor", () => {
  it("extracts PDF text chunks with file path and page numbers", async () => {
    const fixture = readFileSync(fixturePath);
    const extractor = new PdfExtractor({ maxChunkLength: 120 });
    const chunks = await extractor.extract({
      path: "Papers/simple-text.pdf",
      data: fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength),
      modifiedTime: 1,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      source: {
        kind: "pdf",
        path: "Papers/simple-text.pdf",
        pageNumber: 1,
        title: "simple-text.pdf p. 1",
      },
      text: "First page title\nFirst page body.",
    });
    expect(chunks[1]).toMatchObject({
      source: {
        kind: "pdf",
        path: "Papers/simple-text.pdf",
        pageNumber: 3,
        title: "simple-text.pdf p. 3",
      },
      text: "Second page text.",
    });
  });

  it("extracts text from a compressed plain-text PDF fixture", async () => {
    const fixture = readFileSync(plainTextFixturePath);
    const extractor = new PdfExtractor({ maxChunkLength: 2_000 });
    const chunks = await extractor.extract({
      path: "Papers/plain-text.pdf",
      data: fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength),
      modifiedTime: 1,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(chunks.map((chunk) => chunk.source.kind)).toEqual(chunks.map(() => "pdf"));
    expect(
      new Set(
        chunks.map((chunk) => {
          expect(chunk.source.kind).toBe("pdf");
          return chunk.source.kind === "pdf" ? chunk.source.pageNumber : 0;
        }),
      ),
    ).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(chunks[0].source).toMatchObject({
      kind: "pdf",
      path: "Papers/plain-text.pdf",
      pageNumber: 1,
      title: "plain-text.pdf p. 1",
    });
    expect(
      chunks
        .map((chunk) => chunk.text)
        .join("\n")
        .replace(/\s/g, ""),
    ).toContain("Сезонсбораклюквы");
  });

  it("keeps plain-text PDF chunk ids stable across extraction runs", async () => {
    const fixture = readFileSync(plainTextFixturePath);
    const data = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
    const extractor = new PdfExtractor({ maxChunkLength: 2_000 });

    const first = await extractor.extract({
      path: "Papers/plain-text.pdf",
      data,
      modifiedTime: 1,
    });
    const second = await extractor.extract({
      path: "Papers/plain-text.pdf",
      data,
      modifiedTime: 2,
    });

    expect(second.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id));
    expect(second.map((chunk) => chunk.contentHash)).toEqual(
      first.map((chunk) => chunk.contentHash),
    );
  });

  it("extracts page-cited chunks from a small PDF book fixture", async () => {
    const fixture = readFileSync(smallPdfBookFixturePath);
    const extractor = new PdfExtractor({ maxChunkLength: 1_500 });
    const chunks = await extractor.extract({
      path: "Books/small-pdf-book.pdf",
      data: fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength),
      modifiedTime: 1,
    });

    expect(chunks).toHaveLength(13);
    expect(
      new Set(
        chunks.map((chunk) => {
          expect(chunk.source.kind).toBe("pdf");
          return chunk.source.kind === "pdf" ? chunk.source.pageNumber : 0;
        }),
      ),
    ).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]));
    expect(chunks[0].source).toMatchObject({
      kind: "pdf",
      path: "Books/small-pdf-book.pdf",
      pageNumber: 1,
      title: "small-pdf-book.pdf p. 1",
    });
    expect(chunks.every((chunk) => chunk.text.length <= 1_500)).toBe(true);
    expect(chunks.every((chunk) => chunk.id.length === 64)).toBe(true);
    expect(chunks.every((chunk) => chunk.contentHash.length === 64)).toBe(true);
  });

  it("keeps small PDF book chunk ids stable across extraction runs", async () => {
    const fixture = readFileSync(smallPdfBookFixturePath);
    const data = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
    const extractor = new PdfExtractor({ maxChunkLength: 1_500 });

    const first = await extractor.extract({
      path: "Books/small-pdf-book.pdf",
      data,
      modifiedTime: 1,
    });
    const second = await extractor.extract({
      path: "Books/small-pdf-book.pdf",
      data,
      modifiedTime: 2,
    });

    expect(second.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id));
    expect(second.map((chunk) => chunk.contentHash)).toEqual(
      first.map((chunk) => chunk.contentHash),
    );
  });

  it("skips image-only or empty pages without failing the full file", async () => {
    const parser: PdfPageTextParser = {
      async *parsePages() {
        yield { pageNumber: 1, text: "Readable page" };
        yield { pageNumber: 2, text: "   " };
        yield { pageNumber: 3, text: "" };
      },
    };
    const extractor = new PdfExtractor({ parser });
    const chunks = await extractor.extract({
      path: "Papers/scanned.pdf",
      data: new ArrayBuffer(0),
      modifiedTime: 1,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].source).toMatchObject({ kind: "pdf", pageNumber: 1 });
  });

  it("uses cached PDF text when path, mtime, and size are unchanged", async () => {
    let parseCalls = 0;
    const parser: PdfPageTextParser = {
      async *parsePages() {
        parseCalls += 1;
        yield { pageNumber: 1, text: "Cached page text" };
      },
    };
    const cache = new PdfTextCache();
    const extractor = new PdfExtractor({ parser, cache });

    const first = await extractor.extract({
      path: "Papers/cached.pdf",
      data: new ArrayBuffer(10),
      modifiedTime: 1,
      size: 10,
    });
    const second = await extractor.extract({
      path: "Papers/cached.pdf",
      data: new ArrayBuffer(10),
      modifiedTime: 1,
      size: 10,
    });

    expect(parseCalls).toBe(1);
    expect(second).toEqual(first);
    expect(cache.get("Papers/cached.pdf", { mtime: 1, size: 10 })).toMatchObject({
      mtime: 1,
      size: 10,
      content: [{ pageNumber: 1, text: "Cached page text" }],
    });
  });

  it("reparses PDFs when cache metadata changes", async () => {
    let parseCalls = 0;
    const parser: PdfPageTextParser = {
      async *parsePages() {
        parseCalls += 1;
        yield { pageNumber: 1, text: `Run ${parseCalls}` };
      },
    };
    const extractor = new PdfExtractor({ parser, cache: new PdfTextCache() });

    await extractor.extract({
      path: "Papers/cached.pdf",
      data: new ArrayBuffer(10),
      modifiedTime: 1,
      size: 10,
    });
    const changed = await extractor.extract({
      path: "Papers/cached.pdf",
      data: new ArrayBuffer(11),
      modifiedTime: 1,
      size: 11,
    });

    expect(parseCalls).toBe(2);
    expect(changed[0].text).toBe("Run 2");
  });

  it("processes large PDFs page by page in bounded batches", async () => {
    const parsedPages: number[] = [];
    const parser: PdfPageTextParser = {
      async *parsePages() {
        for (let pageNumber = 1; pageNumber <= 4; pageNumber += 1) {
          parsedPages.push(pageNumber);
          yield {
            pageNumber,
            text: Array.from(
              { length: 6 },
              (_, index) => `Page ${pageNumber} paragraph ${index} ${"x".repeat(30)}`,
            ).join("\n\n"),
          };
        }
      },
    };
    const extractor = new PdfExtractor({ parser, maxChunkLength: 120 });
    const chunks = await extractor.extract({
      path: "Papers/large.pdf",
      data: new ArrayBuffer(0),
      modifiedTime: 1,
    });

    expect(parsedPages).toEqual([1, 2, 3, 4]);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.every((chunk) => chunk.text.length <= 120)).toBe(true);
    expect(chunks.map((chunk) => chunk.source.kind)).toEqual(chunks.map(() => "pdf"));
  });

  it("maps malformed PDFs to recoverable extraction errors", async () => {
    const parser: PdfPageTextParser = {
      async *parsePages() {
        throw new Error("bad xref");
      },
    };
    const extractor = new PdfExtractor({ parser });

    await expect(
      extractor.extract({
        path: "Papers/broken.pdf",
        data: new ArrayBuffer(0),
        modifiedTime: 1,
      }),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
  });

  it("only supports PDF files", () => {
    const extractor = new PdfExtractor();

    expect(extractor.supports("Papers/sample.pdf")).toBe(true);
    expect(extractor.supports("Papers/sample.PDF")).toBe(true);
    expect(extractor.supports("Papers/sample.md")).toBe(false);
  });
});
