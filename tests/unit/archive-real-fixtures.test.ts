import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { ZipArchive } from "@adapters/extractors/common";

/**
 * Decodes the checked-in Office fixtures with the browser-side DEFLATE
 * implementation. These are real files produced by real writers, so they cover
 * the dynamic and fixed Huffman streams that synthetic archives may miss.
 */
function readArchive(path: string): ZipArchive {
  const file = readFileSync(path);

  return ZipArchive.read(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
}

describe("real Office fixtures decode with the browser DEFLATE implementation", () => {
  it("reads every entry of a real .docx and recovers its WordprocessingML", () => {
    const archive = readArchive("tests/fixtures/documents/sample.docx");

    expect(archive.names()).toContain("word/document.xml");

    for (const name of archive.names()) {
      expect(archive.bytes(name)?.length ?? 0).toBeGreaterThan(0);
    }

    const xml = archive.text("word/document.xml");
    expect(xml).toContain("<w:document");
    expect(xml).toContain("http://schemas.openxmlformats.org/wordprocessingml");
  });

  it("reads every entry of a real .epub and recovers its package document", () => {
    const archive = readArchive("tests/fixtures/documents/sample.epub");

    expect(archive.names()).toContain("META-INF/container.xml");
    expect(archive.text("META-INF/container.xml")).toContain("rootfile");

    for (const name of archive.names()) {
      expect(archive.bytes(name)?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
