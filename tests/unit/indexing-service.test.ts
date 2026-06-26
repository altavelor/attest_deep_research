import { Extractor, IndexFailedSourceSnapshot, IndexSourceSnapshot, IndexStore, SourceSnapshotIndexStore } from "../../src/application/ports/indexing";
import { EmbeddingProviderClient } from "../../src/core/agent/protocol";
import { EmbeddedChunk, ExtractedChunk } from "../../src/core/model/source";
import { IxplorerError } from "../../src/core/errors";
import {
  IndexingService,
  IndexingFileLogEvent,
} from "../../src/adapters/indexing/IndexingService";
import { VaultFileProvider, VaultFileSummary } from "../../src/application/ports/vault";
import { hashFileData, shouldIndexFile, updateSnapshot } from "../../src/adapters/indexing/changeDetection";

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
      headingPath: ["Test"],
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
      scannedFiles: 2,
      totalFiles: 2,
      progress: 1,
      indexedFiles: 2,
      skippedFiles: 0,
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

  it("never indexes saved chats from the internal Ixplorer folder", async () => {
    const files = new FakeVaultFileProvider([
      file(".ixplorer/chats/chat-1.json", 1, '{"messages":[{"content":"saved answer"}]}'),
      file("Research/a.md", 1, "# A"),
    ]);
    const jsonExtractor = new FakeExtractor(".json");
    const markdownExtractor = new FakeExtractor(".md");
    const indexStore = new FakeIndexStore();
    const service = new IndexingService({
      files,
      extractors: [jsonExtractor, markdownExtractor],
      embeddings: new FakeEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["/"],
      excludeGlobs: [],
    });

    const initialRun = await service.manualReindex();
    expect(initialRun.indexChanged).toBe(true);

    expect(jsonExtractor.extractedPaths).toEqual([]);
    expect(markdownExtractor.extractedPaths).toEqual(["Research/a.md"]);
    expect(files.readPaths).not.toContain(".ixplorer/chats/chat-1.json");
  });

  it("embeds chunks with source path and heading context while storing clean chunk text", async () => {
    const embeddings = new FakeEmbeddingProvider();
    const indexStore = new FakeIndexStore();
    const service = new IndexingService({
      files: new FakeVaultFileProvider([file("Research/a.md", 1, "body text")]),
      extractors: [new FakeExtractor(".md")],
      embeddings,
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
    });

    await service.manualReindex();

    expect(embeddings.inputs[0]).toContain("File: Research/a.md");
    expect(embeddings.inputs[0]).toContain("Heading:");
    expect(indexStore.upserted[0].text).toBe("body text");
  });

  it("logs indexing decisions for indexed, skipped, empty, and failed files", async () => {
    const indexStore = new FakeIndexStore();
    const logger = new FakeIndexingLogger();
    const service = new IndexingService({
      files: new FakeVaultFileProvider([
        file("Research/a.md", 1, "body"),
        file("Research/empty.pdf", 1, ""),
        file("Research/fail.md", 1, "bad"),
        file("Research/broken.pdf", 1, "bad pdf"),
        file("Archive/old.md", 1, "old"),
        file("Research/image.png", 1, "png"),
      ]),
      extractors: [
        new EmptyPathExtractor("Research/empty.pdf"),
        new FailingPathExtractor("Research/fail.md"),
        new FailingIxplorerPathExtractor("Research/broken.pdf"),
        new FakeExtractor(".md"),
        new FakeExtractor(".pdf"),
      ],
      embeddings: new FakeEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: ["Archive/**"],
      logger,
    });

    const result = await service.manualReindex();

    expect(result).toMatchObject({
      indexedFiles: 1,
      skippedFiles: 1,
      failedFiles: 2,
      embeddedChunks: 1,
    });
    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "Research/a.md",
          outcome: "indexed",
          reason: "indexed",
          chunkCount: 1,
        }),
        expect.objectContaining({
          path: "Research/empty.pdf",
          outcome: "skipped",
          reason: "no-extractable-text",
          chunkCount: 0,
        }),
        expect.objectContaining({
          path: "Research/fail.md",
          outcome: "failed",
          reason: "extraction-failed",
          errorMessage: "Extraction failed for Research/fail.md",
        }),
        expect.objectContaining({
          path: "Research/broken.pdf",
          outcome: "failed",
          reason: "extraction-failed",
          errorMessage: "Ixplorer could not read this PDF. Cause: incorrect header check",
          errorDetails: expect.objectContaining({ causeMessage: "incorrect header check" }),
        }),
      ]),
    );
    expect(indexStore.sourceSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: "Research/empty.pdf",
          contentHash: hashFileData(""),
        }),
      ]),
    );
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

    const initialRun = await service.manualReindex();
    expect(initialRun.indexChanged).toBe(true);
    expect(indexStore.upsertCalls).toBe(1);
    expect(files.readPaths).toEqual(["Research/a.md"]);

    const unchangedRun = await service.manualReindex();
    expect(unchangedRun.indexChanged).toBe(false);
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

  it("loads persisted source snapshots so unchanged files are skipped after service reload", async () => {
    const files = new FakeVaultFileProvider([file("Research/a.md", 1, "same")]);
    const indexStore = new FakeIndexStore([
      {
        sourcePath: "Research/a.md",
        modifiedTime: 1,
        contentHash: hashFileData("same"),
      },
    ]);
    const service = new IndexingService({
      files,
      extractors: [new FakeExtractor(".md")],
      embeddings: new FakeEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
    });

    const result = await service.manualReindex();

    expect(result).toMatchObject({ indexedFiles: 0, skippedFiles: 1, embeddedChunks: 0 });
    expect(files.readPaths).toEqual([]);
    expect(indexStore.upsertCalls).toBe(0);
  });

  it("defers remaining files when the changed-file cap is reached", async () => {
    const indexStore = new FakeIndexStore();
    const service = new IndexingService({
      files: new FakeVaultFileProvider([
        file("Research/a.md", 1, "a"),
        file("Research/b.md", 1, "b"),
        file("Research/c.md", 1, "c"),
      ]),
      extractors: [new FakeExtractor(".md")],
      embeddings: new FakeEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
      maxChangedFilesPerRun: 1,
    });

    const result = await service.manualReindex();

    expect(result).toMatchObject({
      status: "stale",
      indexedFiles: 1,
      deferredFiles: 2,
      failedFiles: 0,
      isStale: true,
    });

    const nextRun = await service.manualReindex();
    expect(nextRun).toMatchObject({
      status: "stale",
      indexedFiles: 1,
      skippedFiles: 1,
      deferredFiles: 1,
    });
  });

  it("records failed files and keeps indexing unrelated files", async () => {
    const indexStore = new FakeIndexStore();
    const service = new IndexingService({
      files: new FakeVaultFileProvider([
        file("Research/a.md", 1, "a"),
        file("Research/b.md", 1, "b"),
      ]),
      extractors: [new FailingPathExtractor("Research/a.md"), new FakeExtractor(".md")],
      embeddings: new FakeEmbeddingProvider(),
      indexStore,
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
    });

    const result = await service.manualReindex();

    expect(result).toMatchObject({
      status: "idle",
      indexedFiles: 1,
      failedFiles: 1,
      embeddedChunks: 1,
    });
    expect(indexStore.failedSnapshots).toEqual([
      expect.objectContaining({
        sourcePath: "Research/a.md",
        errorMessage: "Extraction failed for Research/a.md",
      }),
    ]);
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

    const rebuild = await service.rebuild();
    expect(rebuild.indexChanged).toBe(true);
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

  it("reports current file progress in chunks", async () => {
    const progressStates: Array<{
      currentFile?: string;
      chunksTotal?: number;
      chunksEmbedded?: number;
    }> = [];
    const service = new IndexingService({
      files: new FakeVaultFileProvider([file("Research/long.md", 1, "long")]),
      extractors: [new MultiChunkExtractor(".md", 3)],
      embeddings: new FakeEmbeddingProvider(),
      indexStore: new FakeIndexStore(),
      embeddingModel: "nomic",
      includeFolders: ["Research"],
      excludeGlobs: [],
      batchSize: 2,
      onProgress: (state) =>
        progressStates.push({
          currentFile: state.currentFile,
          chunksTotal: state.chunksTotal,
          chunksEmbedded: state.chunksEmbedded,
        }),
    });

    await service.manualReindex();

    expect(progressStates).toEqual(
      expect.arrayContaining([
        { currentFile: "Research/long.md", chunksTotal: 3, chunksEmbedded: 0 },
        { currentFile: "Research/long.md", chunksTotal: 3, chunksEmbedded: 2 },
        { currentFile: "Research/long.md", chunksTotal: 3, chunksEmbedded: 3 },
      ]),
    );
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

  constructor(private readonly extension: string) { }

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

class MultiChunkExtractor implements Extractor {
  constructor(
    private readonly extension: string,
    private readonly chunkCount: number,
  ) { }

  supports(path: string): boolean {
    return path.endsWith(this.extension);
  }

  async extract(input: {
    path: string;
    data: ArrayBuffer | string;
    modifiedTime: number;
  }): Promise<ExtractedChunk[]> {
    return Array.from({ length: this.chunkCount }, (_, index) =>
      markdownChunk(`${input.path}-${index}`, input.path, `chunk ${index}`),
    );
  }
}

class FailingPathExtractor implements Extractor {
  constructor(private readonly failedPath: string) { }

  supports(path: string): boolean {
    return path === this.failedPath;
  }

  async extract(input: { path: string }): Promise<ExtractedChunk[]> {
    throw new Error(`Extraction failed for ${input.path}`);
  }
}

class FailingIxplorerPathExtractor implements Extractor {
  constructor(private readonly failedPath: string) { }

  supports(path: string): boolean {
    return path === this.failedPath;
  }

  async extract(input: { path: string }): Promise<ExtractedChunk[]> {
    throw new IxplorerError({
      code: "EXTRACTION_FAILED",
      message: "Ixplorer could not read this PDF.",
      details: { path: input.path, causeMessage: "incorrect header check" },
    });
  }
}

class EmptyPathExtractor implements Extractor {
  constructor(private readonly emptyPath: string) { }

  supports(path: string): boolean {
    return path === this.emptyPath;
  }

  async extract(): Promise<ExtractedChunk[]> {
    return [];
  }
}

class FakeIndexingLogger {
  readonly events: IndexingFileLogEvent[] = [];

  logIndexingFile(event: IndexingFileLogEvent): void {
    this.events.push(event);
  }
}

class FakeEmbeddingProvider implements EmbeddingProviderClient {
  readonly inputs: string[] = [];

  async listModels(): Promise<string[]> {
    return ["nomic"];
  }

  async embed(request: {
    model: string;
    input: string[];
  }): Promise<{ model: string; embeddings: number[][] }> {
    this.inputs.push(...request.input);

    return {
      model: request.model,
      embeddings: request.input.map((text) => [text.length, 1]),
    };
  }
}

class FakeIndexStore implements IndexStore, SourceSnapshotIndexStore {
  initializedMetadata: { embeddingModel: string; embeddingDimensions: number } | null = null;
  upserted: EmbeddedChunk[] = [];
  deletedPaths: string[] = [];
  sourceSnapshots: IndexSourceSnapshot[];
  failedSnapshots: IndexFailedSourceSnapshot[] = [];
  upsertCalls = 0;
  clearCalls = 0;

  constructor(sourceSnapshots: IndexSourceSnapshot[] = []) {
    this.sourceSnapshots = sourceSnapshots;
  }

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
    this.sourceSnapshots = [];
  }

  async query(): Promise<never[]> {
    return [];
  }

  async loadSourceSnapshots(): Promise<IndexSourceSnapshot[]> {
    return [...this.sourceSnapshots];
  }

  async updateSourceSnapshots(snapshots: IndexSourceSnapshot[]): Promise<void> {
    const bySourcePath = new Map(
      this.sourceSnapshots.map((snapshot) => [snapshot.sourcePath, snapshot]),
    );

    for (const snapshot of snapshots) {
      bySourcePath.set(snapshot.sourcePath, snapshot);
    }

    this.sourceSnapshots = Array.from(bySourcePath.values());
  }

  async recordFailedSourceSnapshots(snapshots: IndexFailedSourceSnapshot[]): Promise<void> {
    this.failedSnapshots.push(...snapshots);
  }
}
