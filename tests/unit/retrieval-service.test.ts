import { formatCitation } from "@core/retrieval";
import { formatCitationLink } from "@application/use-cases/research";
import { rankKeywordMatches } from "@adapters/retrieval";
import { RetrievalService } from "@adapters/retrieval";
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
import { EmbeddingProviderClient } from "@core/agent";
import { IndexStore } from "@application/ports";
import { RetrievedChunk } from "@core/model";

function makeRetrievalService(options: {
  embeddings: EmbeddingProviderClient;
  indexStore: IndexStore;
  embeddingModel: string;
}): RetrievalService {
  const store = options.indexStore as unknown as Record<string, unknown>;
  const has = (method: string) => typeof store[method] === "function";
  return new RetrievalService({
    ...options,
    ...(has("searchKeywords") ? { keyword: options.indexStore as never } : {}),
    ...(has("listIndexedChunks") ? { chunkInventory: options.indexStore as never } : {}),
    ...(has("getLanguageInventory") ? { languageInventory: options.indexStore as never } : {}),
    ...(has("listIndexSources") ? { inventory: options.indexStore as never } : {}),
  });
}

describe("RetrievalService", () => {
  it("returns ranked semantic chunks with citation references", async () => {
    const indexStore = new FakeIndexStore([
      retrieved("semantic-near", markdownSource("Research/ai.md", ["Models"]), "local models", 0.9),
      retrieved("semantic-far", documentSource("Docs/manual.txt", "txt"), "manual docs", 0.4),
    ]);
    const service = makeRetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
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

  it("uses store-backed keyword fallback when embeddings are unavailable or semantic results are empty", async () => {
    const indexStore = new FakeIndexStore([]);
    indexStore.keywordResults = [
      retrieved(
        "fallback-match",
        markdownSource("Research/local.md"),
        "Local model retrieval guide",
        0,
      ),
    ];
    const service = makeRetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
    });

    await expect(
      service.search("local retrieval", { limit: 1, includeWebResults: false }),
    ).resolves.toEqual({
      chunks: [expect.objectContaining({ id: "fallback-match" })],
      citations: [expect.objectContaining({ id: "fallback-match" })],
      usedFallback: true,
      semanticError: "embedding unavailable",
    });
  });

  it("omits web fallback chunks when web results are disabled", async () => {
    const indexStore = new FakeIndexStore([]);
    indexStore.keywordResults = [
      retrieved("web", webSource("https://example.com/a"), "local retrieval web result", 0),
      retrieved("vault", markdownSource("Research/local.md"), "local retrieval vault result", 0),
    ];
    const service = makeRetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
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
    const service = makeRetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
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

  it("uses store-backed keyword search", async () => {
    const indexStore = new FakeIndexStore([]);
    indexStore.keywordResults = [
      retrieved("store-keyword", markdownSource("Research/store.md"), "local keyword", 2),
    ];
    const service = makeRetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
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
    const service = makeRetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
    });

    const result = await service.search("local", { limit: 2, includeWebResults: false });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["semantic", "keyword"]);
  });

  it("uses query variants to find chunks written in a different language", async () => {
    const indexStore = new FakeIndexStore([]);
    indexStore.keywordResultsByQuery.set("sorting algorithms advantages disadvantages", [
      retrieved(
        "english-sorting",
        markdownSource("Books/algorithms.md"),
        "Sorting algorithms include quicksort and merge sort advantages disadvantages",
        0,
      ),
    ]);
    const service = makeRetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
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

  it("lists URL references from indexed chunks with context and cursor pagination", async () => {
    const indexedChunks = [
      retrieved(
        "book-1",
        markdownSource("Books/book.md", ["References"]),
        "Read the official documentation at https://Example.com/docs#intro for API details. See also https://second.example/path.",
        0,
      ),
      retrieved(
        "other-1",
        markdownSource("Other/note.md"),
        "Outside scope https://outside.example",
        0,
      ),
    ];
    const indexStore = Object.assign(new FakeIndexStore([]), {
      async listIndexedChunks(options: {
        limit: number;
        sourcePath?: string;
      }): Promise<{ chunks: typeof indexedChunks; nextCursor?: string }> {
        return {
          chunks: indexedChunks.filter(
            (chunk) =>
              !options.sourcePath ||
              ("path" in chunk.source && chunk.source.path === options.sourcePath),
          ),
        };
      },
    });
    const service = makeRetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
    });

    const first = await service.listIndexedUrls({ limit: 1, sourcePath: "Books/book.md" });
    const second = await service.listIndexedUrls({
      limit: 10,
      sourcePath: "Books/book.md",
      cursor: first.nextCursor,
    });

    expect(first).toMatchObject({
      items: [
        {
          id: "book-1:url:0",
          url: "https://Example.com/docs#intro",
          normalizedUrl: "https://example.com/docs",
          purpose: expect.stringContaining("official documentation"),
          context: expect.stringContaining("API details"),
          chunkId: "book-1",
          source: expect.objectContaining({ path: "Books/book.md" }),
        },
      ],
      nextCursor: "1",
    });
    expect(second.items.map((item) => item.normalizedUrl)).toEqual(["https://second.example/path"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("lists URL references from the index store", async () => {
    const inventoryResults = [
      retrieved(
        "stored-1",
        markdownSource("Books/book.md", ["Links"]),
        "Project page: https://stored.example/project explains the dataset.",
        0,
      ),
    ];
    const indexStore = Object.assign(new FakeIndexStore([]), {
      async listIndexedChunks(): Promise<{ chunks: typeof inventoryResults; nextCursor?: string }> {
        return { chunks: inventoryResults };
      },
    });
    const service = makeRetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
    });

    const result = await service.listIndexedUrls({ limit: 100 });

    expect(result.items).toEqual([
      expect.objectContaining({
        url: "https://stored.example/project",
        normalizedUrl: "https://stored.example/project",
        chunkId: "stored-1",
      }),
    ]);
  });

  it("paginates indexed URL references without skipping multiple URLs in one stored chunk", async () => {
    const inventoryResults = [
      retrieved(
        "stored-1",
        markdownSource("Books/book.md", ["Links"]),
        "First https://one.example and second https://two.example.",
        0,
      ),
    ];
    const indexStore = Object.assign(new FakeIndexStore([]), {
      async listIndexedChunks(): Promise<{ chunks: typeof inventoryResults; nextCursor?: string }> {
        return { chunks: inventoryResults };
      },
    });
    const service = makeRetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
    });

    const first = await service.listIndexedUrls({ limit: 1 });
    const second = await service.listIndexedUrls({ limit: 1, cursor: first.nextCursor });

    expect(first.items.map((item) => item.normalizedUrl)).toEqual(["https://one.example/"]);
    expect(second.items.map((item) => item.normalizedUrl)).toEqual(["https://two.example/"]);
  });

  it("delegates index inventory operations to stores that support them", async () => {
    const source = markdownSource("Books/book.md", ["Intro"]);
    const indexStore = Object.assign(new FakeIndexStore([]), {
      listIndexSources: vi.fn().mockResolvedValue({ items: [{ sourcePath: "Books/book.md" }] }),
      listIndexChunks: vi.fn().mockResolvedValue({ items: [{ chunkId: "chunk-a" }] }),
      readIndexChunk: vi.fn().mockResolvedValue({ chunks: [{ chunkId: "chunk-a" }] }),
      findInIndex: vi.fn().mockResolvedValue({ items: [{ chunkId: "chunk-a" }] }),
      summarizeIndexSource: vi.fn().mockResolvedValue({ sourcePath: "Books/book.md" }),
      getIndexSourceOutline: vi.fn().mockResolvedValue({ sourcePath: "Books/book.md" }),
      searchIndexByMetadata: vi
        .fn()
        .mockResolvedValue({ items: [{ sourcePath: "Books/book.md" }] }),
    });
    const service = makeRetrievalService({
      embeddings: new FailingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
    });

    await expect(service.listIndexSources({ limit: 5 })).resolves.toMatchObject({
      items: [{ sourcePath: "Books/book.md" }],
    });
    await expect(
      service.listIndexChunks({ sourcePath: "Books/book.md", limit: 5 }),
    ).resolves.toMatchObject({ items: [{ chunkId: "chunk-a" }] });
    await expect(
      service.readIndexChunk({ chunkId: "chunk-a", before: 1, after: 1, maxChars: 100 }),
    ).resolves.toMatchObject({ chunks: [{ chunkId: "chunk-a" }] });
    await expect(
      service.findInIndex({ pattern: "alpha", mode: "literal", limit: 5 }),
    ).resolves.toMatchObject({ items: [{ chunkId: "chunk-a" }] });
    await expect(service.summarizeIndexSource("Books/book.md", 5)).resolves.toMatchObject({
      sourcePath: "Books/book.md",
    });
    await expect(service.getIndexSourceOutline("Books/book.md")).resolves.toMatchObject({
      sourcePath: "Books/book.md",
    });
    await expect(
      service.searchIndexByMetadata({ heading: "Intro", limit: 5 }),
    ).resolves.toMatchObject({
      items: [{ sourcePath: "Books/book.md" }],
    });

    expect(indexStore.listIndexChunks).toHaveBeenCalledWith({
      sourcePath: "Books/book.md",
      limit: 5,
    });
    expect(source).toMatchObject({ kind: "markdown" });
  });

  it("restricts results to a single source via sourcePaths", async () => {
    const indexStore = new FakeIndexStore([
      retrieved("a", markdownSource("Books/a.md"), "alpha", 0.9),
      retrieved("b", markdownSource("Books/b.md"), "beta", 0.8),
    ]);
    const service = makeRetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
    });

    const result = await service.search("x", {
      limit: 5,
      includeWebResults: false,
      sourcePaths: ["Books/a.md"],
    });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["a"]);
  });

  it("diversifies to at most one chunk per source", async () => {
    const indexStore = new FakeIndexStore([
      retrieved("a1", markdownSource("Books/a.md"), "alpha one", 0.9),
      retrieved("a2", markdownSource("Books/a.md"), "alpha two", 0.8),
      retrieved("b1", markdownSource("Books/b.md"), "beta one", 0.7),
    ]);
    const service = makeRetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
    });

    const diversified = await service.search("x", {
      limit: 2,
      includeWebResults: false,
      diversify: true,
    });
    expect(diversified.chunks.map((chunk) => chunk.id)).toEqual(["a1", "b1"]);

    const plain = await service.search("x", { limit: 2, includeWebResults: false });
    expect(plain.chunks.map((chunk) => chunk.id)).toEqual(["a1", "a2"]);
  });

  it("scopes a search to the sources indexed in a language", async () => {
    const indexStore = Object.assign(
      new FakeIndexStore([
        retrieved("ru", markdownSource("Books/ru.md"), "текст", 0.9),
        retrieved("en", markdownSource("Books/en.md"), "text", 0.8),
      ]),
      {
        listIndexSources: vi.fn(),
        searchIndexByMetadata: vi
          .fn()
          .mockResolvedValue({ items: [{ sourcePath: "Books/ru.md" }] }),
      },
    );
    const service = makeRetrievalService({
      embeddings: new FakeEmbeddingProvider([[1, 0]]),
      indexStore,
      embeddingModel: "nomic",
    });

    const result = await service.search("x", {
      limit: 5,
      includeWebResults: false,
      language: "ru",
    });

    expect(indexStore.searchIndexByMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ language: "ru" }),
    );
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["ru"]);
  });
});

describe("RetrievalService query variants", () => {
  class RecordingEmbeddingProvider implements EmbeddingProviderClient {
    calls: string[][] = [];

    async listModels(): Promise<string[]> {
      return ["nomic"];
    }

    async embed(request: { model: string; input: string[] }) {
      const offset = this.calls.flat().length;
      this.calls.push([...request.input]);
      return {
        model: "nomic",
        embeddings: request.input.map((_value, index) => [offset + index + 1, 0]),
      };
    }
  }

  class DelayedIndexStore extends FakeIndexStore {
    constructor(private readonly chunksByEmbedding: Map<number, RetrievedChunk[]>) {
      super([]);
    }

    override async query(embedding: number[], _limit: number): Promise<RetrievedChunk[]> {
      const key = embedding[0]!;
      await new Promise((resolve) => setTimeout(resolve, (4 - key) * 5));
      return this.chunksByEmbedding.get(key) ?? [];
    }
  }

  it("embeds the original query and its variants in two batched calls", async () => {
    const embeddings = new RecordingEmbeddingProvider();
    const service = makeRetrievalService({
      embeddings,
      indexStore: new FakeIndexStore([]),
      embeddingModel: "nomic",
    });

    await service.search("original", {
      limit: 2,
      includeWebResults: false,
      queryVariants: [{ query: "variant one" }, { query: "variant two" }],
    });

    expect(embeddings.calls).toEqual([["original"], ["variant one", "variant two"]]);
  });

  it("fuses variant contributions in query order even when slower queries win the race", async () => {
    const indexStore = new DelayedIndexStore(
      new Map([
        [1, [retrieved("from-original", markdownSource("a.md"), "a", 0.1)]],
        [2, [retrieved("from-variant", markdownSource("b.md"), "b", 0.9)]],
      ]),
    );
    const service = makeRetrievalService({
      embeddings: new RecordingEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
    });

    const result = await service.search("original", {
      limit: 2,
      includeWebResults: false,
      queryVariants: [{ query: "variant" }],
    });

    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["from-original", "from-variant"]);
  });

  it("falls back to the original query when the variants promise rejects", async () => {
    const embeddings = new RecordingEmbeddingProvider();
    const service = makeRetrievalService({
      embeddings,
      indexStore: new FakeIndexStore([]),
      embeddingModel: "nomic",
    });

    await service.search("original", {
      limit: 2,
      includeWebResults: false,
      queryVariants: Promise.reject(new Error("expansion failed")),
    });

    expect(embeddings.calls).toEqual([["original"]]);
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
