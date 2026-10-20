import { IndexingService } from "@adapters/indexing";
import { IndexStore, VaultFileSummary } from "@application/ports";
import { EmbeddingProviderClient } from "@core/agent";
import { EmbeddedChunk } from "@core/model";

import { FakeExtractor, FakeVaultFileProvider } from "../support/indexingFakes";

describe("IndexingService large-vault behavior", () => {
  it("indexes many markdown notes and multiple PDFs in bounded embedding and upsert batches", async () => {
    const files = new FakeVaultFileProvider([
      ...Array.from({ length: 10 }, (_, index) =>
        file(`Research/note-${index}.md`, 1, `note ${index}`),
      ),
      file("Research/paper-a.pdf", 1, "pdf a"),
      file("Research/paper-b.pdf", 1, "pdf b"),
      file("Research/paper-c.pdf", 1, "pdf c"),
    ]);
    const embeddings = new RecordingEmbeddingProvider();
    const indexStore = new RecordingIndexStore();
    const service = new IndexingService({
      files,
      extractors: [new FakeExtractor(".md"), new FakeExtractor(".pdf")],
      embeddings,
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
      batchSize: 4,
      yieldEveryFiles: 5,
      yieldToEventLoop: async () => {},
    });

    const result = await service.manualReindex();

    expect(result).toMatchObject({
      status: "idle",
      scannedFiles: 13,
      indexedFiles: 13,
      skippedFiles: 0,
      embeddedChunks: 13,
    });
    expect(embeddings.batchSizes.every((size) => size <= 4)).toBe(true);
    expect(indexStore.upsertBatchSizes.every((size) => size <= 4)).toBe(true);
    expect(embeddings.batchSizes.reduce((sum, size) => sum + size, 0)).toBe(13);
  });

  it("emits progress updates while scanning and embedding large vaults", async () => {
    const progress: Array<{ scannedFiles: number; embeddedChunks: number; status: string }> = [];
    const service = new IndexingService({
      files: new FakeVaultFileProvider([
        file("Research/a.md", 1, "a"),
        file("Research/b.md", 1, "b"),
        file("Research/c.md", 1, "c"),
      ]),
      extractors: [new FakeExtractor(".md")],
      embeddings: new RecordingEmbeddingProvider(),
      indexStore: new RecordingIndexStore(),
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
      batchSize: 2,
      onProgress: (state) =>
        progress.push({
          scannedFiles: state.scannedFiles,
          embeddedChunks: state.embeddedChunks,
          status: state.status,
        }),
    });

    await service.manualReindex();

    expect(progress).toEqual(
      expect.arrayContaining([
        { scannedFiles: 1, embeddedChunks: 0, status: "indexing" },
        { scannedFiles: 2, embeddedChunks: 2, status: "indexing" },
        { scannedFiles: 3, embeddedChunks: 3, status: "idle" },
      ]),
    );
  });

  it("responds to pause during long indexing runs and resumes remaining work later", async () => {
    let service: IndexingService;
    const files = new FakeVaultFileProvider([
      file("Research/a.md", 1, "a"),
      file("Research/b.md", 1, "b"),
      file("Research/c.md", 1, "c"),
    ]);
    const indexStore = new RecordingIndexStore();
    const embeddings = new RecordingEmbeddingProvider();
    let yieldCount = 0;

    service = new IndexingService({
      files,
      extractors: [new FakeExtractor(".md")],
      embeddings,
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
      batchSize: 1,
      yieldEveryFiles: 1,
      yieldToEventLoop: async () => {
        yieldCount += 1;

        if (yieldCount === 1) {
          service.pause();
        }
      },
    });

    const paused = await service.manualReindex();

    expect(paused).toMatchObject({
      status: "paused",
      scannedFiles: 1,
      indexedFiles: 1,
      embeddedChunks: 1,
    });

    service.resume();
    const completed = await service.manualReindex();

    expect(completed).toMatchObject({
      status: "idle",
      scannedFiles: 3,
      indexedFiles: 3,
      skippedFiles: 0,
      embeddedChunks: 3,
    });
  });
});

function file(
  path: string,
  modifiedTime: number,
  data: string,
): VaultFileSummary & { data: string } {
  return { path, modifiedTime, data };
}

class RecordingEmbeddingProvider implements EmbeddingProviderClient {
  readonly batchSizes: number[] = [];

  async listModels(): Promise<string[]> {
    return ["nomic"];
  }

  async embed(request: {
    model: string;
    input: string[];
  }): Promise<{ model: string; embeddings: number[][] }> {
    this.batchSizes.push(request.input.length);

    return {
      model: request.model,
      embeddings: request.input.map((text) => [text.length, 1]),
    };
  }
}

class RecordingIndexStore implements IndexStore {
  readonly upsertBatchSizes: number[] = [];

  async initialize(): Promise<void> {}

  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    this.upsertBatchSizes.push(chunks.length);
  }

  async deleteBySourcePath(): Promise<void> {}

  async clear(): Promise<void> {}

  async query(): Promise<never[]> {
    return [];
  }
}
