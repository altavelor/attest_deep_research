import {
  EnrichIndexSources,
  normalizeReference,
  sharedReferences,
  toDocumentReference,
} from "@application/use-cases/enrichment";
import { DocumentMetadataExtractor, SourceDocumentMetadata } from "@application/ports";
import { ResearchRetriever } from "@application/contracts";
import {
  EnrichmentProfileController,
  FileDocumentClaimStore,
  FileDocumentMetadataStore,
  FileDocumentSummaryStore,
  parseExtractedMetadata,
} from "@adapters/indexing";

import { MemoryFileSystem } from "../helpers/memoryFileSystem";

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
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const store = new FileDocumentMetadataStore(fileSystem, folder);
    const metadata = doc("Tales.pdf", ["Smith J. Privacy. 2021."]);

    await store.write(metadata);

    expect(await store.read("Tales.pdf")).toEqual(metadata);
    expect(await store.read("Other.pdf")).toBeNull();
    expect(await store.list()).toEqual([metadata]);
  });
});

describe("EnrichIndexSources", () => {
  it("extracts changed sources and skips up-to-date ones", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const store = new FileDocumentMetadataStore(fileSystem, folder);
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
  });
});

describe("EnrichIndexSources summaries (Ф4)", () => {
  it("summarizes outline sections and reduces them into a document summary", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const metadataStore = new FileDocumentMetadataStore(fileSystem, folder);
    const summaryStore = new FileDocumentSummaryStore(fileSystem, folder);
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

    const second = await enrichment.run();
    expect(second).toEqual({ extracted: 0, skipped: 1, failed: 0 });
  });

  it("summarizes sections with bounded concurrency, preserves order, and retries transient failures", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const metadataStore = new FileDocumentMetadataStore(fileSystem, folder);
    const summaryStore = new FileDocumentSummaryStore(fileSystem, folder);
    const active: string[] = [];
    let maxActive = 0;
    const calls = new Map<string, number>();

    const enrichment = new EnrichIndexSources({
      retriever: outlineRetriever("book.pdf", [
        sectionOutline(["One"], 0, 0, 2_000),
        sectionOutline(["Two"], 1, 1, 2_000),
        sectionOutline(["Three"], 2, 2, 2_000),
        sectionOutline(["Four"], 3, 3, 2_000),
      ]),
      metadataStore,
      summaryStore,
      extractor: {
        model: "t",
        promptVersion: 1,
        extract: async () => ({ title: "Book", references: [] }),
      },
      summarizer: {
        model: "sum-model",
        promptVersion: 1,
        summarizeSection: async (input) => {
          const name = input.headingPath.at(-1) ?? "";
          calls.set(name, (calls.get(name) ?? 0) + 1);
          if (name === "Two" && calls.get(name) === 1) {
            throw new Error("429 rate limit");
          }
          active.push(name);
          maxActive = Math.max(maxActive, active.length);
          await wait(5);
          active.splice(active.indexOf(name), 1);
          return `Summary of ${name}`;
        },
        summarizeDocument: async (input) => ({
          summary: `Doc summary from ${input.sectionSummaries.length} sections`,
          oneLiner: "A book.",
        }),
      },
      sectionSummaryConcurrency: 2,
      retryBackoffMs: 1,
      now: () => new Date("2026-07-03T00:00:00Z"),
    });

    await expect(enrichment.run()).resolves.toEqual({ extracted: 1, skipped: 0, failed: 0 });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(calls.get("Two")).toBe(2);
    const summaries = await summaryStore.read("book.pdf");
    expect(summaries?.sections.map((section) => section.headingPath.at(-1))).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
    ]);
  });

  it("skips low-value sections and merges adjacent short sections before summarizing", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const summaryStore = new FileDocumentSummaryStore(fileSystem, folder);
    const calls: string[] = [];

    const enrichment = new EnrichIndexSources({
      retriever: outlineRetriever("book.pdf", [
        sectionOutline(["Introduction"], 0, 0, 300),
        sectionOutline(["Acknowledgements"], 1, 1, 1_500),
        sectionOutline(["Background"], 2, 2, 320),
        sectionOutline(["Method"], 3, 3, 2_000),
        sectionOutline(["References"], 4, 4, 3_000),
      ]),
      metadataStore: new FileDocumentMetadataStore(fileSystem, folder),
      summaryStore,
      extractor: {
        model: "t",
        promptVersion: 1,
        extract: async () => ({ title: "Book", references: [] }),
      },
      summarizer: {
        model: "sum-model",
        promptVersion: 1,
        summarizeSection: async (input) => {
          calls.push(input.headingPath.join(" + "));
          return `Summary of ${input.headingPath.join(" + ")}`;
        },
        summarizeDocument: async (input) => ({
          summary: `Doc summary from ${input.sectionSummaries.length} sections`,
          oneLiner: "A book.",
        }),
      },
      now: () => new Date("2026-07-03T00:00:00Z"),
    });

    await enrichment.run();

    expect(calls).toEqual(["Introduction + Background", "Method"]);
    const summaries = await summaryStore.read("book.pdf");
    expect(summaries?.sections).toHaveLength(2);
    expect(summaries?.sections[0]).toMatchObject({
      headingPath: ["Introduction", "Background"],
      chunkStart: 0,
      chunkEnd: 2,
    });
  });

  it("uses a small-document fast path without section summary calls", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    let sectionCalls = 0;
    const enrichment = new EnrichIndexSources({
      retriever: outlineRetriever("short.pdf", [sectionOutline(["Only"], 0, 1, 1_000)], {
        chunkCount: 2,
        charCount: 1_000,
      }),
      metadataStore: new FileDocumentMetadataStore(fileSystem, folder),
      summaryStore: new FileDocumentSummaryStore(fileSystem, folder),
      extractor: {
        model: "t",
        promptVersion: 1,
        extract: async () => ({ title: "Short", references: [] }),
      },
      summarizer: {
        model: "sum-model",
        promptVersion: 1,
        summarizeSection: async () => {
          sectionCalls += 1;
          return "unused";
        },
        summarizeDocument: async (input) => ({
          summary: `Doc summary from ${input.sectionSummaries[0]}`,
          oneLiner: "A short document.",
        }),
      },
    });

    await enrichment.run();

    expect(sectionCalls).toBe(0);
    const summaries = await new FileDocumentSummaryStore(fileSystem, folder).read("short.pdf");
    expect(summaries?.sections).toEqual([]);
    expect(summaries?.document.summary).toContain("Full text of short.pdf");
  });

  it("reuses unchanged section summaries by section hash when the source hash changes", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const summaryStore = new FileDocumentSummaryStore(fileSystem, folder);
    const calls: string[] = [];
    let sourceHash = "hash-v1";
    let changedSectionText = "Full text of changed.pdf Changed";

    const retriever = mutableOutlineRetriever(
      () => sourceHash,
      () => [
        { headingPath: ["Stable"], text: "Full text of changed.pdf Stable", charCount: 2_000 },
        { headingPath: ["Changed"], text: changedSectionText, charCount: 2_000 },
      ],
    );

    const createEnrichment = () =>
      new EnrichIndexSources({
        retriever,
        metadataStore: new FileDocumentMetadataStore(fileSystem, folder),
        summaryStore,
        extractor: {
          model: "t",
          promptVersion: 1,
          extract: async () => ({ title: "Changed", references: [] }),
        },
        summarizer: {
          model: "sum-model",
          promptVersion: 1,
          summarizeSection: async (input) => {
            const name = input.headingPath.at(-1) ?? "";
            calls.push(name);
            return `Summary of ${name} ${calls.length}`;
          },
          summarizeDocument: async (input) => ({
            summary: `Doc summary from ${input.sectionSummaries.length} sections`,
            oneLiner: "A changed document.",
          }),
        },
      });

    await createEnrichment().run();
    sourceHash = "hash-v2";
    changedSectionText = "Full text of changed.pdf Changed updated";
    await createEnrichment().run();

    expect(calls).toEqual(["Stable", "Changed", "Changed"]);
    const summaries = await summaryStore.read("changed.pdf");
    expect(summaries?.contentHash).toBe("hash-v2");
    expect(summaries?.sections.map((section) => section.summary)).toEqual([
      "Summary of Stable 1",
      "Summary of Changed 3",
    ]);
  });
});

function sectionOutline(
  headingPath: string[],
  chunkStart: number,
  chunkEnd: number,
  charCount = 5_000,
) {
  return {
    headingPath,
    title: headingPath.at(-1) ?? "",
    level: headingPath.length,
    chunkStart,
    chunkEnd,
    chunkCount: chunkEnd - chunkStart + 1,
    charCount,
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

describe("EnrichIndexSources claims (Ф7)", () => {
  it("extracts claims per content section and skips references; re-run is incremental", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const metadataStore = new FileDocumentMetadataStore(fileSystem, folder);
    const claimStore = new FileDocumentClaimStore(fileSystem, folder);
    const extractCalls: string[] = [];

    const enrichment = new EnrichIndexSources({
      retriever: outlineRetriever("book.pdf", [
        sectionOutline(["Findings"], 0, 4, 3_000),
        sectionOutline(["References"], 5, 9, 3_000),
      ]),
      metadataStore,
      extractor: {
        model: "t",
        promptVersion: 1,
        extract: async () => ({ title: "Book", references: [] }),
      },
      claimStore,
      claimExtractor: {
        model: "claim-model",
        promptVersion: 1,
        extract: async (input) => {
          extractCalls.push(input.headingPath.join(">"));
          return [
            {
              subject: "effect",
              statement: `Claim from ${input.headingPath.at(-1)}.`,
              topicKeys: ["t"],
            },
          ];
        },
      },
      now: () => new Date("2026-07-03T00:00:00Z"),
    });

    const result = await enrichment.run();

    expect(result).toEqual({ extracted: 1, skipped: 0, failed: 0 });

    expect(extractCalls).toEqual(["Findings"]);
    const stored = await claimStore.read("book.pdf");
    expect(stored?.claims).toHaveLength(1);
    expect(stored?.claims[0]).toMatchObject({
      chunkId: "book.pdf-Findings",
      sourcePath: "book.pdf",
      subject: "effect",
    });
    expect(stored?.generation.model).toBe("claim-model");

    const second = await enrichment.run();
    expect(second).toEqual({ extracted: 0, skipped: 1, failed: 0 });
    expect(extractCalls).toEqual(["Findings"]);
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

function outlineRetriever(
  sourcePath: string,
  sections: ReturnType<typeof sectionOutline>[],
  outlineOverrides: { chunkCount?: number; charCount?: number } = {},
): ResearchRetriever {
  return {
    ...fakeRetriever([sourcePath]),
    getIndexSourceOutline: async () => ({
      sourcePath,
      title: sourcePath,
      kind: "pdf" as const,
      chunkCount: outlineOverrides.chunkCount ?? Math.max(1, sections.length),
      charCount:
        outlineOverrides.charCount ?? sections.reduce((sum, section) => sum + section.charCount, 0),
      sections,
    }),
    listIndexChunks: async ({ sourcePath: requestedPath, headingPath }) => ({
      items: [
        {
          chunkId: `${requestedPath}-${headingPath?.join("-") ?? "head"}`,
          sourcePath: requestedPath,
          chunkIndex: 0,
          title: requestedPath,
          headingPath,
          textPreview: `Preview of ${headingPath?.join(" ") ?? requestedPath}`,
          charCount: 2_000,
          source: {
            id: `${requestedPath}-source`,
            kind: "pdf" as const,
            title: requestedPath,
            path: requestedPath,
            pageNumber: 1,
          },
        },
      ],
    }),
    readIndexChunk: async ({ chunkId }) => ({
      chunks: [
        {
          chunkId,
          sourcePath,
          chunkIndex: 0,
          text: `Full text of ${sourcePath} ${chunkId}`,
          charCount: 2_000,
          truncated: false,
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

function mutableOutlineRetriever(
  contentHash: () => string,
  sectionTexts: () => Array<{ headingPath: string[]; text: string; charCount: number }>,
): ResearchRetriever {
  const sourcePath = "changed.pdf";
  return {
    ...fakeRetriever([sourcePath]),
    listIndexSources: async () => ({
      items: [
        {
          sourcePath,
          title: sourcePath,
          kind: "pdf" as const,
          modifiedTime: 0,
          indexedAt: "2026-01-01T00:00:00.000Z",
          chunkCount: sectionTexts().length + 2,
          contentHash: contentHash(),
        },
      ],
    }),
    getIndexSourceOutline: async () => ({
      sourcePath,
      title: sourcePath,
      kind: "pdf" as const,
      chunkCount: sectionTexts().length + 2,
      charCount: sectionTexts().reduce((sum, section) => sum + section.charCount, 0),
      sections: sectionTexts().map((section, index) =>
        sectionOutline(section.headingPath, index, index, section.charCount),
      ),
    }),
    listIndexChunks: async ({ headingPath }) => ({
      items: [
        {
          chunkId: `${sourcePath}-${headingPath?.join("-") ?? "head"}`,
          sourcePath,
          chunkIndex: headingPath?.[0] === "Changed" ? 1 : 0,
          title: sourcePath,
          headingPath,
          textPreview: "",
          charCount:
            sectionTexts().find(
              (section) => section.headingPath.join("\0") === headingPath?.join("\0"),
            )?.charCount ?? 1_000,
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
    readIndexChunk: async ({ chunkId }) => {
      const matching = sectionTexts().find((section) =>
        chunkId.endsWith(section.headingPath.join("-")),
      );
      return {
        chunks: [
          {
            chunkId,
            sourcePath,
            chunkIndex: matching?.headingPath[0] === "Changed" ? 1 : 0,
            text: matching?.text ?? `Full text of ${sourcePath}`,
            charCount: matching?.charCount ?? 1_000,
            truncated: false,
            source: {
              id: `${sourcePath}-source`,
              kind: "pdf" as const,
              title: sourcePath,
              path: sourcePath,
              pageNumber: 1,
            },
          },
        ],
      };
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
