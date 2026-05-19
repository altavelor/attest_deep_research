import {
  EmbeddedChunk,
  EmbeddingProviderClient,
  ExtractedChunk,
  Extractor,
  IndexStore,
} from "../../src/shared/types";
import {
  IndexingService,
  VaultFileProvider,
  VaultFileSummary,
} from "../../src/indexing/IndexingService";
import { shouldIndexFile, updateSnapshot } from "../../src/indexing/changeDetection";

function markdownChunk(id: string, path: string, text = `text ${id}`): ExtractedChunk {
  return {
    id,
    text,
    contentHash: `chunk-hash-${id}`,
    source: {
      id: `source-${id}`,
      kind: "markdown",
      path,
      title: path,
      headingPath: [],
    },
  };
}

describe("change detection", () => {
  it("skips unchanged files by modification time and detects changed hashes", () => {
    const snapshots = new Map<string, { modifiedTime: number; contentHash: string }>();
    updateSnapshot(snapshots, { path: "Research/a.md", modifiedTime: 1, contentHash: "same" });

    expect(shouldIndexFile(snapshots, { path: "Research/a.md", modifiedTime: 1 })).toBe(false);
    expect(
      shouldIndexFile(snapshots, {
        path: "Research/a.md",
        modifiedTime: 2,
        contentHash: "same",
      }),
    ).toBe(false);
    expect(
      shouldIndexFile(snapshots, {
        path: "Research/a.md",
        modifiedTime: 2,
        contentHash: "changed",
      }),
    ).toBe(true);
  });
});

describe("IndexingService", () => {
  it("manual reindex indexes only included supported files", async () => {
    const files = new FakeVaultFileProvider([
      file("Research/a.md", 1, "# A"),
      file("Research/notes.txt", 1, "plain text"),
      file("Archive/old.md", 1, "# Old"),
      file(".obsidian/config.md", 1, "# Private"),
      file("Research/image.png", 1, "png"),
    ]);
    const markdownExtractor = new FakeExtractor(".md");
    const textExtractor = new FakeExtractor(".txt");
    const indexStore = new FakeIndexStore();
    const service = new IndexingService({
      files,
      extractors: [markdownExtractor, textExtractor],
      embeddings: new FakeEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [".obsidian/**"],
    });

    const result = await service.manualReindex();

    expect(result).toMatchObject({
      scannedFiles: 5,
      totalFiles: 5,
      progress: 1,
      indexedFiles: 2,
      skippedFiles: 3,
      embeddedChunks: 2,
      isStale: false,
    });
    expect(markdownExtractor.extractedPaths).toEqual(["Research/a.md"]);
    expect(textExtractor.extractedPaths).toEqual(["Research/notes.txt"]);
    expect(indexStore.initializedMetadata).toEqual({
      embeddingModel: "nomic",
      embeddingDimensions: 2,
    });
    expect(
      indexStore.upserted.map((chunk) => chunk.source.kind === "markdown" && chunk.source.path),
    ).toEqual(["Research/a.md", "Research/notes.txt"]);
  });

  it("incremental indexing skips unchanged files and avoids upserting unchanged content", async () => {
    const files = new FakeVaultFileProvider([file("Research/a.md", 1, "same")]);
    const extractor = new FakeExtractor(".md");
    const indexStore = new FakeIndexStore();
    const service = new IndexingService({
      files,
      extractors: [extractor],
      embeddings: new FakeEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
    });

    await service.manualReindex();
    expect(indexStore.upsertCalls).toBe(1);
    expect(files.readPaths).toEqual(["Research/a.md"]);

    await service.manualReindex();
    expect(indexStore.upsertCalls).toBe(1);
    expect(files.readPaths).toEqual(["Research/a.md"]);

    files.replace(file("Research/a.md", 2, "same"));
    await service.manualReindex();
    expect(indexStore.upsertCalls).toBe(1);
    expect(files.readPaths).toEqual(["Research/a.md", "Research/a.md"]);

    files.replace(file("Research/a.md", 3, "changed"));
    await service.manualReindex();
    expect(indexStore.upsertCalls).toBe(2);
    expect(indexStore.deletedPaths).toEqual(["Research/a.md", "Research/a.md"]);
  });

  it("pause, resume, clear, and rebuild update scheduler state", async () => {
    const files = new FakeVaultFileProvider([file("Research/a.md", 1, "first")]);
    const indexStore = new FakeIndexStore();
    const service = new IndexingService({
      files,
      extractors: [new FakeExtractor(".md")],
      embeddings: new FakeEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
    });

    service.pause();
    await expect(service.manualReindex()).resolves.toMatchObject({ status: "paused" });
    expect(service.getState().status).toBe("paused");
    expect(indexStore.upsertCalls).toBe(0);

    service.resume();
    await service.manualReindex();
    expect(service.getState()).toMatchObject({ status: "idle", indexedFiles: 1 });
    expect(indexStore.upsertCalls).toBe(1);

    await service.clear();
    expect(indexStore.clearCalls).toBe(1);
    expect(service.getState()).toMatchObject({
      status: "idle",
      scannedFiles: 0,
      totalFiles: 0,
      progress: 0,
      indexedFiles: 0,
      isStale: false,
    });

    await service.rebuild();
    expect(indexStore.clearCalls).toBe(2);
    expect(indexStore.upsertCalls).toBe(2);
  });

  it("reports progress during manual reindex and can mark idle state stale", async () => {
    const progressStates: Array<ReturnType<IndexingService["getState"]>> = [];
    const service = new IndexingService({
      files: new FakeVaultFileProvider([
        file("Research/a.md", 1, "first"),
        file("Research/b.md", 1, "second"),
      ]),
      extractors: [new FakeExtractor(".md")],
      embeddings: new FakeEmbeddingProvider(),
      indexStore: new FakeIndexStore(),
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
      onProgress: (state) => progressStates.push(state),
    });

    const result = await service.manualReindex();

    expect(progressStates.some((state) => state.status === "indexing")).toBe(true);
    expect(progressStates.some((state) => state.totalFiles === 2 && state.progress === 0.5)).toBe(
      true,
    );
    expect(result).toMatchObject({ status: "idle", totalFiles: 2, progress: 1 });

    service.markStale();
    expect(service.getState()).toMatchObject({ status: "stale", isStale: true });
  });
});

function file(
  path: string,
  modifiedTime: number,
  data: string,
): VaultFileSummary & { data: string } {
  return { path, modifiedTime, data };
}

class FakeVaultFileProvider implements VaultFileProvider {
  readPaths: string[] = [];
  private files: Array<VaultFileSummary & { data: string }>;

  constructor(files: Array<VaultFileSummary & { data: string }>) {
    this.files = files;
  }

  async listFiles(): Promise<VaultFileSummary[]> {
    return this.files.map(({ path, modifiedTime }) => ({ path, modifiedTime }));
  }

  async readFile(path: string): Promise<ArrayBuffer | string> {
    this.readPaths.push(path);
    return this.files.find((file) => file.path === path)?.data ?? "";
  }

  replace(file: VaultFileSummary & { data: string }): void {
    this.files = this.files.map((existing) => (existing.path === file.path ? file : existing));
  }
}

class FakeExtractor implements Extractor {
  extractedPaths: string[] = [];

  constructor(private readonly extension: string) {}

  supports(path: string): boolean {
    return path.endsWith(this.extension);
  }

  async extract(input: {
    path: string;
    data: ArrayBuffer | string;
    modifiedTime: number;
  }): Promise<ExtractedChunk[]> {
    this.extractedPaths.push(input.path);
    return [markdownChunk(input.path, input.path, String(input.data))];
  }
}

class FakeEmbeddingProvider implements EmbeddingProviderClient {
  async listModels(): Promise<string[]> {
    return ["nomic"];
  }

  async embed(request: {
    model: string;
    input: string[];
  }): Promise<{ model: string; embeddings: number[][] }> {
    return {
      model: request.model,
      embeddings: request.input.map((text) => [text.length, 1]),
    };
  }
}

class FakeIndexStore implements IndexStore {
  initializedMetadata: { embeddingModel: string; embeddingDimensions: number } | null = null;
  upserted: EmbeddedChunk[] = [];
  deletedPaths: string[] = [];
  upsertCalls = 0;
  clearCalls = 0;

  async initialize(metadata: {
    embeddingModel: string;
    embeddingDimensions: number;
  }): Promise<void> {
    this.initializedMetadata = metadata;
  }

  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    this.upsertCalls += 1;
    this.upserted.push(...chunks);
  }

  async deleteBySourcePath(path: string): Promise<void> {
    this.deletedPaths.push(path);
  }

  async clear(): Promise<void> {
    this.clearCalls += 1;
    this.upserted = [];
  }

  async query(): Promise<never[]> {
    return [];
  }
}
