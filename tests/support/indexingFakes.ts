import { Extractor, VaultFileProvider, VaultFileSummary } from "@application/ports";
import { IndexingState } from "@adapters/indexing";
import { ExtractedChunk } from "@core/model";

export function markdownChunk(id: string, path: string, text = `text ${id}`): ExtractedChunk {
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

/** In-memory vault that records which paths were read. */
export class FakeVaultFileProvider implements VaultFileProvider {
  readPaths: string[] = [];
  private files: Array<VaultFileSummary & { data: string }>;

  constructor(files: Array<VaultFileSummary & { data: string }>) {
    this.files = files;
  }

  async listFiles(): Promise<VaultFileSummary[]> {
    return this.files.map(({ path, modifiedTime, size }) => ({ path, modifiedTime, size }));
  }

  async readFile(path: string): Promise<ArrayBuffer | string> {
    this.readPaths.push(path);
    return this.files.find((file) => file.path === path)?.data ?? "";
  }

  replace(file: VaultFileSummary & { data: string }): void {
    this.files = this.files.map((existing) => (existing.path === file.path ? file : existing));
  }
}

/** Extractor for one extension that returns the file text as a single chunk. */
export class FakeExtractor implements Extractor {
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

/** Indexing service double that reports each lifecycle transition through onProgress. */
export class FakeIndexingService {
  onProgress: ((state: IndexingState) => void) | null = null;
  startCalls = 0;
  rebuildCalls = 0;
  failNextStart = false;
  startError: unknown;
  private state: IndexingState = {
    status: "idle",
    scannedFiles: 0,
    totalFiles: 0,
    progress: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    embeddedChunks: 0,
    deferredFiles: 0,
    failedFiles: 0,
    isStale: false,
  };

  getState(): IndexingState {
    return { ...this.state };
  }

  protected setStatus(status: IndexingState["status"]): void {
    this.state = { ...this.state, status };
    this.onProgress?.(this.getState());
  }

  async manualReindex(): Promise<IndexingState> {
    this.startCalls += 1;
    this.state = {
      ...this.state,
      status: "indexing",
      activeOperation: "indexing",
      scannedFiles: 1,
      totalFiles: 2,
      progress: 0.5,
    };
    this.onProgress?.(this.getState());

    if (this.startError) {
      const error = this.startError;
      this.startError = undefined;
      throw error;
    }

    if (this.failNextStart) {
      this.failNextStart = false;
      throw new Error("Embedding provider unavailable");
    }

    this.state = {
      ...this.state,
      status: "idle",
      activeOperation: undefined,
      scannedFiles: 1,
      totalFiles: 1,
      progress: 1,
      indexedFiles: 1,
      lastIndexedAt: "2026-06-14T10:00:00.000Z",
      isStale: false,
    };
    this.onProgress?.(this.getState());
    return this.getState();
  }

  pause(): void {
    this.state = { ...this.state, status: "paused" };
    this.onProgress?.(this.getState());
  }

  resume(): void {
    this.state = { ...this.state, status: "idle" };
    this.onProgress?.(this.getState());
  }

  async rebuild(): Promise<IndexingState> {
    this.rebuildCalls += 1;
    return this.manualReindex();
  }

  markStale(): void {
    this.state = { ...this.state, status: "stale", isStale: true };
    this.onProgress?.(this.getState());
  }

  setIndexSizeBytes(indexSizeBytes?: number): void {
    this.state = { ...this.state, indexSizeBytes };
    this.onProgress?.(this.getState());
  }
}
