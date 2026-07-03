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
import { FileDocumentMetadataStore, parseExtractedMetadata } from "@adapters/indexing";

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
