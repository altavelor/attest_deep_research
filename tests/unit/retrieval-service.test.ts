import { formatCitation, formatCitationLink } from "../../src/retrieval/citations";
import { rankKeywordMatches } from "../../src/retrieval/ranking";
import { RetrievalService } from "../../src/retrieval/RetrievalService";
import {
  documentSource,
  markdownSource,
  pdfSource,
  retrieved,
  webSource,
} from "../helpers/factories";
import {
  FailingEmbeddingProvider,
  FakeEmbeddingProvider,
  FakeIndexStore,
} from "../helpers/retrievalFakes";

describe("RetrievalService", () => {
  it("returns ranked semantic chunks with citation references", async () => {
    const indexStore = new FakeIndexStore([
      retrieved("semantic-near", markdownSource("Research/ai.md", ["Models"]), "local models", 0.9),
      retrieved("semantic-far", documentSource("Docs/manual.txt", "txt"), "manual docs", 0.4),
    ]);
    const service = new RetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
      keywordCorpus: [],
    });

    await expect(
      service.search("local models", { limit: 2, includeWebResults: false }),
    ).resolves.toEqual({
      chunks: [
        expect.objectContaining({ id: "semantic-near" }),
        expect.objectContaining({ id: "semantic-far" }),
      ],
      citations: [
        expect.objectContaining({ id: "semantic-near", label: "Research/ai.md > Models" }),
        expect.objectContaining({ id: "semantic-far", label: "Docs/manual.txt" }),
      ],
      usedFallback: false,
    });
    expect(indexStore.queries).toEqual([{ embedding: [1, 0], limit: 8 }]);
    expect(indexStore.initializations).toEqual([
      { embeddingModel: "nomic", embeddingDimensions: 2 },
    ]);
  });

  it("uses keyword fallback when embeddings are unavailable or semantic results are empty", async () => {
    const service = new RetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore: new FakeIndexStore([]),
      embeddingModel: "nomic",
      keywordCorpus: [
        retrieved(
          "fallback-match",
          markdownSource("Research/local.md"),
          "Local model retrieval guide",
          0,
        ),
        retrieved("fallback-miss", markdownSource("Research/remote.md"), "Remote server notes", 0),
      ],
    });

    await expect(
      service.search("local retrieval", { limit: 1, includeWebResults: false }),
    ).resolves.toEqual({
      chunks: [expect.objectContaining({ id: "fallback-match" })],
      citations: [expect.objectContaining({ id: "fallback-match" })],
      usedFallback: true,
    });
  });

  it("omits web fallback chunks when web results are disabled", async () => {
    const service = new RetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore: new FakeIndexStore([]),
      embeddingModel: "nomic",
      keywordCorpus: [
        retrieved("web", webSource("https://example.com/a"), "local retrieval web result", 0),
        retrieved("vault", markdownSource("Research/local.md"), "local retrieval vault result", 0),
      ],
    });

    const result = await service.search("local retrieval", { limit: 5, includeWebResults: false });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["vault"]);
  });

  it("applies score, source-kind, and extension filters to semantic results", async () => {
    const indexStore = new FakeIndexStore([
      retrieved("md", markdownSource("Research/ai.md"), "markdown", 0.8),
      retrieved("pdf", pdfSource("Papers/report.pdf", 4), "pdf", 0.7),
      retrieved("txt", documentSource("Docs/manual.txt", "txt"), "txt", 0.2),
    ]);
    const service = new RetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
      keywordCorpus: [],
    });

    const result = await service.search("local", {
      limit: 10,
      includeWebResults: false,
      minScore: 0.5,
      sourceKinds: ["markdown", "pdf"],
      fileExtensions: ["md"],
    });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["md"]);
  });

  it("uses store-backed keyword search before the static fallback corpus", async () => {
    const indexStore = new FakeIndexStore([]);
    indexStore.keywordResults = [
      retrieved("store-keyword", markdownSource("Research/store.md"), "local keyword", 2),
    ];
    const service = new RetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      keywordCorpus: [
        retrieved("static-keyword", markdownSource("Research/static.md"), "local keyword", 0),
      ],
    });

    const result = await service.search("local", { limit: 5, includeWebResults: false });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["store-keyword"]);
    expect(indexStore.keywordQueries).toEqual(["local"]);
  });

  it("fuses semantic and keyword candidates before applying the final limit", async () => {
    const indexStore = new FakeIndexStore([
      retrieved("semantic", markdownSource("Research/semantic.md"), "semantic match", 0.9),
    ]);
    indexStore.keywordResults = [
      retrieved("keyword", markdownSource("Research/keyword.md"), "keyword match", 3),
    ];
    const service = new RetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
      keywordCorpus: [],
    });

    const result = await service.search("local", { limit: 2, includeWebResults: false });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["semantic", "keyword"]);
  });

  it("uses query variants to find chunks written in a different language", async () => {
    const service = new RetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore: new FakeIndexStore([]),
      embeddingModel: "nomic",
      keywordCorpus: [
        retrieved(
          "english-sorting",
          markdownSource("Books/algorithms.md"),
          "Sorting algorithms include quicksort and merge sort advantages disadvantages",
          0,
        ),
      ],
    });

    const result = await service.search("методы сортировки плюсы минусы", {
      limit: 1,
      includeWebResults: false,
      queryVariants: [
        {
          query: "sorting algorithms advantages disadvantages",
          language: "en",
          reason: "translated",
        },
      ],
    });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["english-sorting"]);
    expect(result.usedFallback).toBe(true);
  });

  it("expands adjacent chunks when the index store supports it", async () => {
    const indexStore = new FakeIndexStore([
      retrieved("hit", markdownSource("Research/a.md"), "hit", 0.9),
    ]);
    indexStore.adjacentResults = [
      retrieved("before", markdownSource("Research/a.md"), "before", 0.8),
      retrieved("hit", markdownSource("Research/a.md"), "hit", 0.9),
    ];
    const service = new RetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
      keywordCorpus: [],
    });

    const result = await service.search("local", { limit: 2, includeWebResults: false });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["before", "hit"]);
  });

  it("expands adjacent evidence on demand", async () => {
    const hit = retrieved("hit", markdownSource("Research/a.md"), "hit", 0.9);
    const indexStore = new FakeIndexStore([hit]);
    indexStore.adjacentResults = [
      retrieved("before", markdownSource("Research/a.md"), "before", 0.8),
      hit,
      retrieved("after", markdownSource("Research/a.md"), "after", 0.7),
    ];
    const service = new RetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
      keywordCorpus: [],
    });

    const expanded = await service.expandAdjacentEvidence([hit], 2, 3);

    expect(expanded.map((chunk) => chunk.id)).toEqual(["before", "hit", "after"]);
  });

  it("loads adjacent chunks by source and chunk id on demand", async () => {
    const source = markdownSource("Research/a.md");
    const indexStore = new FakeIndexStore([]);
    indexStore.directAdjacentResults = [
      retrieved("before", source, "before", 0),
      retrieved("hit", source, "hit", 0),
      retrieved("after", source, "after", 0),
    ];
    const service = new RetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
      keywordCorpus: [],
    });

    const adjacent = await service.getAdjacentChunks(source, "hit", 2);

    expect(adjacent.map((chunk) => chunk.id)).toEqual(["before", "hit", "after"]);
    expect(indexStore.directAdjacentRequests).toEqual([{ source, chunkId: "hit", radius: 2 }]);
  });
});

describe("rankKeywordMatches", () => {
  it("ranks chunks by query term matches and stable tie-break score", () => {
    const ranked = rankKeywordMatches(
      "local model",
      [
        retrieved("one", markdownSource("one.md"), "local model local", 0.1),
        retrieved("two", markdownSource("two.md"), "local", 0.9),
        retrieved("none", markdownSource("none.md"), "unrelated", 99),
      ],
      2,
    );

    expect(ranked.map((chunk) => [chunk.id, chunk.score])).toEqual([
      ["one", 3],
      ["two", 1],
    ]);
  });
});

describe("citations", () => {
  it("formats markdown, pdf, document, and web citation links", () => {
    expect(formatCitation(markdownSource("Research/ai.md", ["Models"], "block-1"))).toMatchObject({
      label: "Research/ai.md > Models",
    });
    expect(formatCitationLink(markdownSource("Research/ai.md", ["Models"], "block-1"))).toBe(
      "[Research/ai.md > Models](Research/ai.md#^block-1)",
    );
    expect(formatCitationLink(pdfSource("Papers/report.pdf", 4))).toBe(
      "[Papers/report.pdf p. 4](Papers/report.pdf#page=4)",
    );
    expect(formatCitationLink(documentSource("Docs/manual.txt", "txt"))).toBe(
      "[Docs/manual.txt](Docs/manual.txt)",
    );
    expect(formatCitationLink(webSource("https://example.com/a"))).toBe(
      "[Example](https://example.com/a)",
    );
  });
});
