import { PdfExtractor, PdfPageTextParser } from "@adapters/extractors";

describe("PdfExtractor chunk identity", () => {
  it("keeps chunk ids and content hashes stable when only modification time changes", async () => {
    const parser: PdfPageTextParser = {
      async *parsePages() {
        yield { pageNumber: 1, text: "Сезон сбора клюквы.\n\n".repeat(20) };
        yield { pageNumber: 2, text: "A second page with different content." };
      },
    };
    const extractor = new PdfExtractor({ parser, maxChunkLength: 120, chunkOverlap: 20 });
    const input = { path: "Papers/plain-text.pdf", data: new ArrayBuffer(0) };
    const first = await extractor.extract({ ...input, modifiedTime: 1 });
    const second = await extractor.extract({ ...input, modifiedTime: 2 });

    expect(first.length).toBeGreaterThan(2);
    expect(first.every((chunk) => chunk.id.length === 64 && chunk.contentHash.length === 64)).toBe(
      true,
    );
    expect(second.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id));
    expect(second.map((chunk) => chunk.contentHash)).toEqual(
      first.map((chunk) => chunk.contentHash),
    );
  });
});
