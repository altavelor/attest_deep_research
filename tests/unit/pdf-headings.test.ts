import {
  headingPathAt,
  headingsFromTypography,
  PdfExtractor,
  PdfParsedDocument,
  PdfTextLine,
  positionHeadings,
  resolvePdfHeadings,
} from "@adapters/extractors";
import { PdfSourceReference } from "@core/model";

describe("pdfHeadings", () => {
  it("prefers a non-trivial outline over typography", () => {
    const outline = [
      { title: "Chapter One", level: 1, pageNumber: 1 },
      { title: "Chapter Two", level: 1, pageNumber: 5 },
      { title: "Chapter Three", level: 1, pageNumber: 9 },
    ];
    const lines = [line("SHOUTING BODY TEXT", 10, 2)];

    expect(resolvePdfHeadings(outline, lines, 10)).toEqual(outline);
  });

  it("detects large-font and all-caps headings via typography", () => {
    const lines: PdfTextLine[] = [
      line("Riquet with the Tuft", 18, 3),
      line("THE SLEEPING BEAUTY", 10, 7),
      ...bodyLines(10, 10),
    ];

    const headings = headingsFromTypography(lines, 10);

    expect(headings.map((heading) => heading.title)).toEqual([
      "Riquet with the Tuft",
      "THE SLEEPING BEAUTY",
    ]);
    // Крупный шрифт — уровень 1, капс обычного размера — уровень ниже.
    expect(headings[0].level).toBeLessThan(headings[1].level);
  });

  it("filters running headers repeating across pages and trailing-punctuation lines", () => {
    const lines: PdfTextLine[] = [
      ...Array.from({ length: 8 }, (_, page) => line("FAIRY TALES 12", 10, page + 1)),
      line("A REAL HEADING", 10, 4),
      line("Sentence that ends with a period.", 18, 5),
      ...bodyLines(10, 8),
    ];

    const headings = headingsFromTypography(lines, 8);

    expect(headings.map((heading) => heading.title)).toEqual(["A REAL HEADING"]);
  });

  it("gives up when heading candidates are implausibly dense", () => {
    const lines: PdfTextLine[] = Array.from({ length: 30 }, (_, index) =>
      line(`LOUD LINE ${index} X`.replace(/\d+/g, String(index)), 18, (index % 3) + 1),
    );

    expect(headingsFromTypography(lines, 3)).toEqual([]);
  });

  it("resolves nested heading paths for chunk positions", () => {
    const positioned = positionHeadings(
      [
        { title: "Part I", level: 1, pageNumber: 1 },
        { title: "Chapter 1", level: 2, pageNumber: 2 },
        { title: "Chapter 2", level: 2, pageNumber: 6 },
        { title: "Part II", level: 1, pageNumber: 9 },
      ],
      () => "",
    );

    expect(headingPathAt(positioned, 3, 0)).toEqual(["Part I", "Chapter 1"]);
    expect(headingPathAt(positioned, 7, 100)).toEqual(["Part I", "Chapter 2"]);
    expect(headingPathAt(positioned, 9, 0)).toEqual(["Part II"]);
    expect(headingPathAt(positioned, 1, 0)).toEqual(["Part I"]);
  });
});

describe("PdfExtractor headingPath", () => {
  it("stamps chunks with the section from the parsed outline", async () => {
    const parser = {
      parsePages: async function* (): AsyncIterable<{ pageNumber: number; text: string }> {},
      parseDocument: async (): Promise<PdfParsedDocument> => ({
        pages: [
          { pageNumber: 1, text: "Riquet with the Tuft" },
          { pageNumber: 2, text: "Once upon a time there was a Queen." },
          { pageNumber: 5, text: "The Sleeping Beauty story begins here." },
        ],
        outline: [
          { title: "Riquet with the Tuft", level: 1, pageNumber: 1 },
          { title: "The Sleeping Beauty", level: 1, pageNumber: 5 },
          { title: "Cinderella", level: 1, pageNumber: 9 },
        ],
        lines: [],
      }),
    };

    const extractor = new PdfExtractor({ parser });
    const chunks = await extractor.extract({
      path: "Tales.pdf",
      data: new ArrayBuffer(0),
      modifiedTime: 1,
    });

    const sources = chunks.map((chunk) => chunk.source as PdfSourceReference);
    expect(sources[0].headingPath).toEqual(["Riquet with the Tuft"]);
    expect(sources[1].headingPath).toEqual(["Riquet with the Tuft"]);
    expect(sources[2].headingPath).toEqual(["The Sleeping Beauty"]);
  });

  it("leaves headingPath absent for parsers without structured output", async () => {
    const parser = {
      parsePages: async function* (): AsyncIterable<{ pageNumber: number; text: string }> {
        yield { pageNumber: 1, text: "Plain page text." };
      },
    };

    const extractor = new PdfExtractor({ parser });
    const chunks = await extractor.extract({
      path: "Plain.pdf",
      data: new ArrayBuffer(0),
      modifiedTime: 1,
    });

    expect(chunks).toHaveLength(1);
    expect((chunks[0].source as PdfSourceReference).headingPath).toBeUndefined();
  });
});

function line(text: string, fontSize: number, pageNumber: number): PdfTextLine {
  return { text, fontSize, pageNumber };
}

function bodyLines(fontSize: number, pages: number): PdfTextLine[] {
  return Array.from({ length: pages * 4 }, (_, index) => ({
    text: `Regular paragraph line number ${index} flowing across the page and staying ordinary.`,
    fontSize,
    pageNumber: (index % pages) + 1,
  }));
}
