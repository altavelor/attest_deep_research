import * as obsidian from "obsidian";
import { PdfExtractor, PdfJsTextParser } from "@adapters/extractors";

describe("host PDF runtime", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads lazily, parses pages in bounded batches, and destroys its own task", async () => {
    const loader = vi.spyOn(obsidian, "loadPdfJs");
    const destroy = vi.fn(async () => {});
    let active = 0;
    let peak = 0;
    const input = new Uint8Array([1, 2, 3]);
    const getDocument = vi.fn((options: { data: Uint8Array }) => {
      expect(options.data).toEqual(input);
      expect(options.data.buffer).not.toBe(input.buffer);
      return {
        destroy,
        promise: Promise.resolve({
          numPages: 3,
          async getPage(page: number) {
            active += 1;
            peak = Math.max(peak, active);
            return {
              async getTextContent() {
                active -= 1;
                return { items: [{ str: `Page ${page}`, hasEOL: true }] };
              },
            };
          },
        }),
      };
    });
    loader.mockResolvedValue({ getDocument, VerbosityLevel: { ERRORS: 0 } });
    const parser = new PdfJsTextParser({ pageConcurrency: 2 });

    expect(loader).not.toHaveBeenCalled();
    const result = await parser.parseDocument(input.buffer);

    expect(loader).toHaveBeenCalledOnce();
    expect(result.pages).toEqual([
      { pageNumber: 1, text: "Page 1" },
      { pageNumber: 2, text: "Page 2" },
      { pageNumber: 3, text: "Page 3" },
    ]);
    expect(peak).toBe(2);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys a failed document task and preserves the extraction error", async () => {
    const failure = new Error("invalid PDF");
    const destroy = vi.fn(async () => {});
    vi.spyOn(obsidian, "loadPdfJs").mockResolvedValue({
      VerbosityLevel: { ERRORS: 0 },
      getDocument: () => ({ promise: Promise.reject(failure), destroy }),
    });

    await expect(
      new PdfExtractor().extract({ path: "bad.pdf", data: new ArrayBuffer(0), modifiedTime: 1 }),
    ).rejects.toMatchObject({
      code: "EXTRACTION_FAILED",
      message: "Attest could not read this PDF.",
      cause: failure,
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("reports host loader failures as recoverable PDF extraction errors", async () => {
    const failure = new Error("host PDF runtime unavailable");
    vi.spyOn(obsidian, "loadPdfJs").mockRejectedValue(failure);

    await expect(
      new PdfExtractor().extract({ path: "a.pdf", data: new ArrayBuffer(0), modifiedTime: 1 }),
    ).rejects.toMatchObject({ code: "EXTRACTION_FAILED", cause: failure });
  });
});
