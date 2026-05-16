import {
  EmbeddedChunk,
  EmbeddingProviderClient,
  ExtractedChunk,
  Extractor,
  IndexStore,
} from "../shared/types";
import { FileSnapshot, hashFileData, shouldIndexFile, updateSnapshot } from "./changeDetection";

export interface VaultFileSummary {
  path: string;
  modifiedTime: number;
}

export interface VaultFileProvider {
  listFiles(): Promise<VaultFileSummary[]>;
  readFile(path: string): Promise<ArrayBuffer | string>;
}

export type IndexingStatus = "idle" | "indexing" | "paused";

export interface IndexingState {
  status: IndexingStatus;
  scannedFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  embeddedChunks: number;
  lastIndexedAt?: string;
}

export interface IndexingServiceOptions {
  files: VaultFileProvider;
  extractors: Extractor[];
  embeddings: EmbeddingProviderClient;
  indexStore: IndexStore;
  embeddingModel: string;
  includeFolders: string[];
  excludeGlobs: string[];
  batchSize?: number;
  now?: () => Date;
}

interface IndexedFileResult {
  indexed: boolean;
  skipped: boolean;
  chunks: ExtractedChunk[];
  contentHash?: string;
}

const DEFAULT_BATCH_SIZE = 32;

export class IndexingService {
  private readonly files: VaultFileProvider;
  private readonly extractors: Extractor[];
  private readonly embeddings: EmbeddingProviderClient;
  private readonly indexStore: IndexStore;
  private readonly embeddingModel: string;
  private readonly includeFolders: string[];
  private readonly excludeGlobs: string[];
  private readonly batchSize: number;
  private readonly now: () => Date;
  private readonly snapshots = new Map<string, FileSnapshot>();
  private state: IndexingState = {
    status: "idle",
    scannedFiles: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    embeddedChunks: 0,
  };

  constructor(options: IndexingServiceOptions) {
    this.files = options.files;
    this.extractors = options.extractors;
    this.embeddings = options.embeddings;
    this.indexStore = options.indexStore;
    this.embeddingModel = options.embeddingModel;
    this.includeFolders = options.includeFolders;
    this.excludeGlobs = options.excludeGlobs;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.now = options.now ?? (() => new Date());
  }

  getState(): IndexingState {
    return { ...this.state };
  }

  pause(): void {
    this.state = { ...this.state, status: "paused" };
  }

  resume(): void {
    if (this.state.status === "paused") {
      this.state = { ...this.state, status: "idle" };
    }
  }

  async clear(): Promise<void> {
    await this.indexStore.clear();
    this.snapshots.clear();
    this.state = {
      status: this.state.status === "paused" ? "paused" : "idle",
      scannedFiles: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      embeddedChunks: 0,
    };
  }

  async rebuild(): Promise<IndexingState> {
    await this.indexStore.clear();
    this.snapshots.clear();
    return this.manualReindex();
  }

  async manualReindex(): Promise<IndexingState> {
    if (this.state.status === "paused") {
      return this.getState();
    }

    this.state = {
      status: "indexing",
      scannedFiles: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      embeddedChunks: 0,
    };

    const files = await this.files.listFiles();
    const extractedChunks: ExtractedChunk[] = [];
    const indexedFiles: Array<VaultFileSummary & { contentHash: string }> = [];
    let skippedFiles = 0;

    for (const file of files) {
      const result = await this.processFile(file);

      if (result.skipped) {
        skippedFiles += 1;
      }

      if (result.indexed && result.contentHash) {
        indexedFiles.push({ ...file, contentHash: result.contentHash });
        extractedChunks.push(...result.chunks);
      }
    }

    const embeddedChunks = await this.embedAndStoreChunks(extractedChunks);

    for (const file of indexedFiles) {
      updateSnapshot(this.snapshots, file);
    }

    this.state = {
      status: "idle",
      scannedFiles: files.length,
      indexedFiles: indexedFiles.length,
      skippedFiles,
      embeddedChunks: embeddedChunks.length,
      lastIndexedAt: this.now().toISOString(),
    };

    return this.getState();
  }

  private async processFile(file: VaultFileSummary): Promise<IndexedFileResult> {
    const extractor = this.extractors.find((candidate) => candidate.supports(file.path));

    if (!extractor || !this.shouldScanPath(file.path)) {
      return { indexed: false, skipped: true, chunks: [] };
    }

    if (!shouldIndexFile(this.snapshots, file)) {
      return { indexed: false, skipped: true, chunks: [] };
    }

    const data = await this.files.readFile(file.path);
    const contentHash = hashFileData(data);

    if (!shouldIndexFile(this.snapshots, { ...file, contentHash })) {
      updateSnapshot(this.snapshots, { ...file, contentHash });
      return { indexed: false, skipped: true, chunks: [] };
    }

    const chunks = await extractor.extract({
      path: file.path,
      data,
      modifiedTime: file.modifiedTime,
    });

    await this.indexStore.deleteBySourcePath(file.path);

    return {
      indexed: true,
      skipped: false,
      chunks,
      contentHash,
    };
  }

  private async embedAndStoreChunks(chunks: ExtractedChunk[]): Promise<EmbeddedChunk[]> {
    const embeddedChunks: EmbeddedChunk[] = [];

    for (let start = 0; start < chunks.length; start += this.batchSize) {
      const batch = chunks.slice(start, start + this.batchSize);

      if (batch.length === 0) {
        continue;
      }

      const response = await this.embeddings.embed({
        model: this.embeddingModel,
        input: batch.map((chunk) => chunk.text),
      });
      const batchEmbeddings = batch.map((chunk, index) => ({
        ...chunk,
        embedding: response.embeddings[index],
        embeddingModel: response.model,
      }));

      if (batchEmbeddings.length > 0) {
        await this.ensureStoreInitialized(batchEmbeddings[0].embedding.length);
        await this.indexStore.upsert(batchEmbeddings);
        embeddedChunks.push(...batchEmbeddings);
      }
    }

    return embeddedChunks;
  }

  private async ensureStoreInitialized(embeddingDimensions: number): Promise<void> {
    await this.indexStore.initialize({
      embeddingModel: this.embeddingModel,
      embeddingDimensions,
    });
  }

  private shouldScanPath(path: string): boolean {
    return (
      isIncluded(path, this.includeFolders) &&
      !this.excludeGlobs.some((glob) => globMatches(path, glob))
    );
  }
}

function isIncluded(path: string, includeFolders: string[]): boolean {
  return includeFolders.some((folder) => {
    const normalizedFolder = normalizeFolder(folder);

    return (
      normalizedFolder === "" ||
      path === normalizedFolder ||
      path.startsWith(`${normalizedFolder}/`)
    );
  });
}

function normalizeFolder(folder: string): string {
  const normalized = folder.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");

  return normalized === "." ? "" : normalized;
}

function globMatches(path: string, glob: string): boolean {
  const normalizedGlob = glob.replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalizedGlob) {
    return false;
  }

  return globToRegExp(normalizedGlob).test(path);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const nextCharacter = glob[index + 1];

    if (character === "*" && nextCharacter === "*") {
      pattern += ".*";
      index += 1;
    } else if (character === "*") {
      pattern += "[^/]*";
    } else {
      pattern += escapeRegExp(character);
    }
  }

  return new RegExp(`${pattern}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}
