import { formatCitation, formatCitationLink } from "../../src/retrieval/citations";
import { rankKeywordMatches } from "../../src/retrieval/ranking";
import { RetrievalService } from "../../src/retrieval/RetrievalService";
import {
  EmbeddingProviderClient,
  IndexStore,
  RetrievedChunk,
  SourceReference,
} from "../../src/shared/types";

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
        expect.objectContaining({ id: "semantic-near", score: 0.9 }),
        expect.objectContaining({ id: "semantic-far", score: 0.4 }),
      ],
      citations: [
        expect.objectContaining({ id: "semantic-near", label: "Research/ai.md > Models" }),
        expect.objectContaining({ id: "semantic-far", label: "Docs/manual.txt" }),
      ],
      usedFallback: false,
    });
    expect(indexStore.queries).toEqual([{ embedding: [1, 0], limit: 2 }]);
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
      chunks: [expect.objectContaining({ id: "fallback-match", score: 2 })],
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

function retrieved(
  id: string,
  source: SourceReference,
  text: string,
  score: number,
): RetrievedChunk {
  return { id, source, text, score, contentHash: `hash-${id}` };
}

function markdownSource(
  path: string,
  headingPath: string[] = [],
  blockId?: string,
): SourceReference {
  return {
    id: `source-${path}`,
    kind: "markdown",
    path,
    title: path,
    headingPath,
    ...(blockId ? { blockId } : {}),
  };
}

function pdfSource(path: string, pageNumber: number): SourceReference {
  return { id: `source-${path}`, kind: "pdf", path, title: path, pageNumber };
}

function documentSource(path: string, format: "txt" | "fb2" | "epub" | "docx"): SourceReference {
  return { id: `source-${path}`, kind: "document", path, title: path, format };
}

function webSource(url: string): SourceReference {
  return {
    id: `source-${url}`,
    kind: "web",
    url,
    title: "Example",
    snippet: "Snippet",
    retrievedAt: "2026-05-16T00:00:00.000Z",
    wasContentFetched: true,
  };
}

class FakeEmbeddingProvider implements EmbeddingProviderClient {
  constructor(private readonly embeddings: number[][]) {}

  async listModels(): Promise<string[]> {
    return ["nomic"];
  }

  async embed(): Promise<{ model: string; embeddings: number[][] }> {
    return { model: "nomic", embeddings: this.embeddings };
  }
}

class FailingEmbeddingProvider implements EmbeddingProviderClient {
  async listModels(): Promise<string[]> {
    return [];
  }

  async embed(): Promise<{ model: string; embeddings: number[][] }> {
    throw new Error("embedding unavailable");
  }
}

class FakeIndexStore implements IndexStore {
  initializations: Array<{ embeddingModel: string; embeddingDimensions: number }> = [];
  queries: Array<{ embedding: number[]; limit: number }> = [];
  keywordQueries: string[] = [];
  keywordResults: RetrievedChunk[] = [];

  constructor(private readonly chunks: RetrievedChunk[]) {}

  async initialize(metadata: {
    embeddingModel: string;
    embeddingDimensions: number;
  }): Promise<void> {
    this.initializations.push(metadata);
  }

  async upsert(): Promise<void> {}

  async deleteBySourcePath(): Promise<void> {}

  async clear(): Promise<void> {}

  async query(embedding: number[], limit: number): Promise<RetrievedChunk[]> {
    this.queries.push({ embedding, limit });
    return this.chunks.slice(0, limit);
  }

  async searchKeywords(query: string): Promise<RetrievedChunk[]> {
    this.keywordQueries.push(query);
    return this.keywordResults;
  }
}
