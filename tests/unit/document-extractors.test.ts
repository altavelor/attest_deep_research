import { readFileSync } from "fs";
import { join } from "path";

import { DocxExtractor } from "../../src/extractors/DocxExtractor";
import { EpubExtractor } from "../../src/extractors/EpubExtractor";
import { Fb2Extractor } from "../../src/extractors/Fb2Extractor";
import { TextExtractor } from "../../src/extractors/TextExtractor";

const fixturesDir = join(__dirname, "../fixtures/documents");

function fixtureArrayBuffer(name: string): ArrayBuffer {
  const fixture = readFileSync(join(fixturesDir, name));
  return fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
}

describe("document extractors", () => {
  it("extracts .txt files with document metadata", async () => {
    const extractor = new TextExtractor({ maxChunkLength: 80 });
    const chunks = await extractor.extract({
      path: "Documents/research.txt",
      data: readFileSync(join(fixturesDir, "research.txt"), "utf8"),
      modifiedTime: 1,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({
      source: {
        kind: "document",
        path: "Documents/research.txt",
        format: "txt",
        title: "research.txt",
      },
    });
    expect(chunks.map((chunk) => chunk.text).join("\n")).toContain(
      "Local document extraction keeps notes searchable.",
    );
  });

  it("extracts .fb2 files with document metadata", async () => {
    const extractor = new Fb2Extractor({ maxChunkLength: 200 });
    const chunks = await extractor.extract({
      path: "Books/story.fb2",
      data: readFileSync(join(fixturesDir, "story.fb2"), "utf8"),
      modifiedTime: 1,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      source: {
        kind: "document",
        path: "Books/story.fb2",
        format: "fb2",
        title: "story.fb2",
      },
    });
    expect(chunks[0].text).toContain("FB2 text should be extracted from paragraphs.");
    expect(chunks[0].text).toContain("Entity text like & references should be decoded.");
  });

  it("extracts .epub files from XHTML spine content", async () => {
    const extractor = new EpubExtractor({ maxChunkLength: 200 });
    const chunks = await extractor.extract({
      path: "Books/sample.epub",
      data: fixtureArrayBuffer("sample.epub"),
      modifiedTime: 1,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      source: {
        kind: "document",
        path: "Books/sample.epub",
        format: "epub",
        title: "sample.epub",
      },
    });
    expect(chunks[0].text).toContain("EPUB chapter text is extracted from XHTML.");
  });

  it("extracts .docx files from word/document.xml", async () => {
    const extractor = new DocxExtractor({ maxChunkLength: 200 });
    const chunks = await extractor.extract({
      path: "Documents/sample.docx",
      data: fixtureArrayBuffer("sample.docx"),
      modifiedTime: 1,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      source: {
        kind: "document",
        path: "Documents/sample.docx",
        format: "docx",
        title: "sample.docx",
      },
    });
    expect(chunks[0].text).toContain("DOCX paragraph text is extracted.");
    expect(chunks[0].text).toContain("Second DOCX paragraph keeps order.");
  });

  it("reports malformed document files as recoverable extraction errors", async () => {
    await expect(
      new Fb2Extractor().extract({
        path: "Books/broken.fb2",
        data: "<FictionBook><description /></FictionBook>",
        modifiedTime: 1,
      }),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
    await expect(
      new EpubExtractor().extract({
        path: "Books/broken.epub",
        data: new TextEncoder().encode("not a zip").buffer,
        modifiedTime: 1,
      }),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
    await expect(
      new DocxExtractor().extract({
        path: "Documents/broken.docx",
        data: new TextEncoder().encode("not a zip").buffer,
        modifiedTime: 1,
      }),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
  });

  it("returns no chunks for unsupported paths", async () => {
    await expect(
      new TextExtractor().extract({
        path: "Documents/research.md",
        data: "not text for this extractor",
        modifiedTime: 1,
      }),
    ).resolves.toEqual([]);
    expect(new EpubExtractor().supports("Books/sample.pdf")).toBe(false);
    expect(new Fb2Extractor().supports("Books/sample.fb2")).toBe(true);
    expect(new DocxExtractor().supports("Documents/sample.DOCX")).toBe(true);
  });
});
