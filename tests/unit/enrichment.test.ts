import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  EnrichIndexSources,
  normalizeReference,
  sharedReferences,
  toDocumentReference,
} from "@application/use-cases/enrichment";
import {
  DocumentMetadataExtractor,
  SourceDocumentMetadata,
} from "@application/ports";
import { ResearchRetriever } from "@application/contracts";
import {
  EnrichmentProfileController,
  FileDocumentMetadataStore,
  FileDocumentSummaryStore,
  parseExtractedMetadata,
} from "@adapters/indexing";

describe("bibliography normalization", () => {
  it("extracts DOI, year, and a title key from a raw reference", () => {
    const normalized = normalizeReference(
      "Smith J., Doe A. Privacy in the Digital Age. Journal of Security, 2021. doi:10.1234/jsec.2021.042",
    );

    expect(normalized?.doi).toBe("10.1234/jsec.2021.042");
    expect(normalized?.year).toBe(2021);
    expect(normalized?.title).toContain("smith");
  });

  it("matches shared references by DOI and by normalized title", () => {
    const docs = [
      doc("a.pdf", [
        "Smith J. Privacy in the Digital Age. 2021. doi:10.1234/jsec.2021.042",
        "Brown K. Unique Work One. Some Venue, 2019.",
      ]),
      doc("b.pdf", [
        "SMITH, J. — Privacy in the Digital Age (2021), DOI: 10.1234/jsec.2021.042",
        "White L. Unique Work Two. Another Venue, 2020.",
      ]),
      doc("c.pdf", ["Lee M. Common Threat Modeling Methods for Analysts. Press, 2018."]),
      doc("d.pdf", ["Lee M. Common Threat Modeling Methods for Analysts. Press, 2018."]),
    ];

    const shared = sharedReferences(docs, 2);

    expect(shared).toHaveLength(2);
    expect(shared.find((r) => r.doi === "10.1234/jsec.2021.042")?.citedBy).toEqual([
      "a.pdf",
      "b.pdf",
    ]);
    expect(shared.find((r) => r.key.startsWith("title:"))?.citedBy).toEqual(["c.pdf", "d.pdf"]);
  });
});

describe("parseExtractedMetadata", () => {
  it("parses strict JSON and JSON wrapped in prose or fences", () => {
    const json = `{"title":"T","authors":["A"],"year":2020,"abstract":"S.","references":["Smith J. Privacy. 2021."]}`;

    expect(parseExtractedMetadata(json).title).toBe("T");
    expect(parseExtractedMetadata("Here you go:\n```json\n" + json + "\n```").year).toBe(2020);
  });

  it("degrades to an empty result on garbage output", () => {
    expect(parseExtractedMetadata("I cannot help with that.")).toEqual({ references: [] });
  });
});

describe("FileDocumentMetadataStore", () => {
  it("round-trips metadata and lists it", async () => {
    const folder = mkdtempSync(join(tmpdir(), "ixplorer-meta-"));
    try {
      const store = new FileDocumentMetadataStore(folder);
      const metadata = doc("Tales.pdf", ["Smith J. Privacy. 2021."]);

      await store.write(metadata);

      expect(await store.read("Tales.pdf")).toEqual(metadata);
      expect(await store.read("Other.pdf")).toBeNull();
      expect(await store.list()).toEqual([metadata]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("EnrichIndexSources", () => {
  it("extracts changed sources and skips up-to-date ones", async () => {
    const folder = mkdtempSync(join(tmpdir(), "ixplorer-enrich-"));
    try {
      const store = new FileDocumentMetadataStore(folder);
      await store.write(doc("b.pdf", []));

      const extractor: DocumentMetadataExtractor & { calls: string[] } = {
        model: "test-model",
        promptVersion: 1,
        calls: [],
        async extract(input) {
          this.calls.push(input.sourcePath);
          return { title: `Title of ${input.sourcePath}`, references: ["Smith J. Privacy. 2021."] };
        },
      };

      const enrichment = new EnrichIndexSources({
        retriever: fakeRetriever(["a.pdf", "b.pdf"]),
        metadataStore: store,
        extractor,
        now: () => new Date("2026-07-03T00:00:00Z"),
      });

      const result = await enrichment.run();

      expect(result).toEqual({ extracted: 1, skipped: 1, failed: 0 });
      expect(extractor.calls).toEqual(["a.pdf"]);
      const written = await store.read("a.pdf");
      expect(written?.title).toBe("Title of a.pdf");
      expect(written?.references[0].normalized?.year).toBe(2021);
      expect(written?.extraction).toEqual({
        model: "test-model",
        promptVersion: 1,
        extractedAt: "2026-07-03T00:00:00.000Z",
      });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("EnrichIndexSources summaries (Ф4)", () => {
  it("summarizes outline sections and reduces them into a document summary", async () => {
    const folder = mkdtempSync(join(tmpdir(), "ixplorer-summaries-"));
    try {
      const metadataStore = new FileDocumentMetadataStore(folder);
      const summaryStore = new FileDocumentSummaryStore(folder);
      const sectionCalls: string[] = [];

      const enrichment = new EnrichIndexSources({
        retriever: {
          ...fakeRetriever(["book.pdf"]),
          getIndexSourceOutline: async () => ({
            sourcePath: "book.pdf",
            title: "book.pdf",
            kind: "pdf" as const,
            chunkCount: 20,
            charCount: 10_000,
            sections: [
              sectionOutline(["Riquet with the Tuft"], 0, 9),
              sectionOutline(["The Sleeping Beauty"], 10, 19),
            ],
          }),
        },
        metadataStore,
        summaryStore,
        extractor: {
          model: "t",
          promptVersion: 1,
          extract: async () => ({ title: "Fairy Tales", references: [] }),
        },
        summarizer: {
          model: "sum-model",
          promptVersion: 1,
          summarizeSection: async (input) => {
            sectionCalls.push(input.headingPath.join(">"));
            return `Summary of ${input.headingPath.at(-1)}`;
          },
          summarizeDocument: async (input) => ({
            summary: `Doc summary from ${input.sectionSummaries.length} sections`,
            oneLiner: "A fairy tale collection.",
          }),
        },
        now: () => new Date("2026-07-03T00:00:00Z"),
      });

      const result = await enrichment.run();

      expect(result).toEqual({ extracted: 1, skipped: 0, failed: 0 });
      expect(sectionCalls).toEqual(["Riquet with the Tuft", "The Sleeping Beauty"]);
      const summaries = await summaryStore.read("book.pdf");
      expect(summaries?.document).toEqual({
        summary: "Doc summary from 2 sections",
        oneLiner: "A fairy tale collection.",
      });
      expect(summaries?.sections.map((s) => s.summary)).toEqual([
        "Summary of Riquet with the Tuft",
        "Summary of The Sleeping Beauty",
      ]);

      // Повторный прогон: оба sidecar-а свежие → скип без вызовов LLM.
      const second = await enrichment.run();
      expect(second).toEqual({ extracted: 0, skipped: 1, failed: 0 });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

function sectionOutline(headingPath: string[], chunkStart: number, chunkEnd: number) {
  return {
    headingPath,
    title: headingPath.at(-1) ?? "",
    level: headingPath.length,
    chunkStart,
    chunkEnd,
    chunkCount: chunkEnd - chunkStart + 1,
    charCount: 5_000,
  };
}

describe("EnrichmentProfileController", () => {
  it("runs onComplete before notifying subscribers about the done state", async () => {
    const events: string[] = [];
    const controller = new EnrichmentProfileController({
      createService: () =>
        new EnrichIndexSources({
          retriever: fakeRetriever(["a.pdf"]),
          metadataStore: {
            read: async () => null,
            write: async () => {},
            list: async () => [],
          },
          extractor: {
            model: "t",
            promptVersion: 1,
            extract: async () => ({ references: [] }),
          },
        }),
      onComplete: async () => {
        events.push("complete");
      },
    });
    controller.subscribeAll(() => {
      if (controller.getState("p").status === "done") {
        events.push(`done-notified`);
      }
    });

    await controller.start("p", "chat-model");

    expect(events).toEqual(["complete", "done-notified"]);
  });
});

function doc(sourcePath: string, rawReferences: string[]): SourceDocumentMetadata {
  return {
    schemaVersion: 1,
    sourcePath,
    contentHash: `hash-${sourcePath}`,
    references: rawReferences.map(toDocumentReference),
    extraction: { model: "test", promptVersion: 1, extractedAt: "2026-01-01T00:00:00.000Z" },
  };
}

function fakeRetriever(sourcePaths: string[]): ResearchRetriever {
  return {
    search: async () => ({ chunks: [], citations: [], usedFallback: false }),
    listIndexSources: async () => ({
      items: sourcePaths.map((sourcePath) => ({
        sourcePath,
        title: sourcePath,
        kind: "pdf" as const,
        modifiedTime: 0,
        indexedAt: "2026-01-01T00:00:00.000Z",
        chunkCount: 3,
        contentHash: `hash-${sourcePath}`,
      })),
    }),
    listIndexChunks: async ({ sourcePath }) => ({
      items: [
        {
          chunkId: `${sourcePath}-chunk-0`,
          sourcePath,
          chunkIndex: 0,
          title: sourcePath,
          textPreview: `Head of ${sourcePath}`,
          charCount: 20,
          source: {
            id: `${sourcePath}-source`,
            kind: "pdf" as const,
            title: sourcePath,
            path: sourcePath,
            pageNumber: 1,
          },
        },
      ],
    }),
  };
}
