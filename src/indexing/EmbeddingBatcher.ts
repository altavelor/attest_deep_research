import type { EmbeddedChunk, ExtractedChunk, IndexStore } from "../shared/types";
import type {
  EmbedAndStoreInput,
  EmbeddingBatcherOptions,
  IndexingPerformanceLogEvent,
} from "./types";

export class EmbeddingBatcher {
  private readonly embeddings: EmbeddingBatcherOptions["embeddings"];
  private readonly embeddingModel: string;
  private readonly batchSize: number;
  private readonly indexStore: IndexStore;
  private readonly progress: EmbeddingBatcherOptions["progress"];
  private readonly yieldToEventLoop: () => Promise<void>;
  private readonly logger?: EmbeddingBatcherOptions["logger"];

  constructor(options: EmbeddingBatcherOptions) {
    this.embeddings = options.embeddings;
    this.embeddingModel = options.embeddingModel;
    this.batchSize = options.batchSize;
    this.indexStore = options.indexStore;
    this.progress = options.progress;
    this.yieldToEventLoop = options.yieldToEventLoop;
    this.logger = options.logger;
  }

  async embedAndStoreChunks(input: EmbedAndStoreInput): Promise<EmbeddedChunk[]> {
    const embeddedChunks: EmbeddedChunk[] = [];
    const embeddingBatchesTotal = Math.ceil(input.chunks.length / this.batchSize);
    let deletedExistingSources = false;

    for (let start = 0; start < input.chunks.length; start += this.batchSize) {
      const batch = input.chunks.slice(start, start + this.batchSize);

      if (batch.length === 0) {
        continue;
      }

      if (this.progress.isPaused()) {
        break;
      }

      this.progress.setEmbeddingProgress({
        chunksTotal: input.chunks.length,
        chunksEmbedded: embeddedChunks.length,
        embeddingBatchesTotal,
        embeddingBatchesCompleted: Math.floor(start / this.batchSize),
        currentFile: sourcePathForChunk(batch[0]),
      });
      const embeddingStartedAt = Date.now();
      const response = await this.embeddings.embed({
        model: this.embeddingModel,
        input: batch.map(textForEmbedding),
      });
      this.logPerformance({
        phase: "embedding",
        durationMs: Date.now() - embeddingStartedAt,
        chunkCount: batch.length,
        batchSize: batch.length,
        batchIndex: Math.floor(start / this.batchSize) + 1,
        batchCount: embeddingBatchesTotal,
      });
      const batchEmbeddings = batch.map((chunk, index) => ({
        ...chunk,
        embedding: response.embeddings[index],
        embeddingModel: response.model,
      }));

      if (batchEmbeddings.length > 0) {
        await this.ensureStoreInitialized(batchEmbeddings[0].embedding.length);
        const storeWriter = (await input.getWriter?.()) ?? this.indexStore;
        if (!deletedExistingSources) {
          for (const sourcePath of input.sourcePathsToReplace) {
            await storeWriter.deleteBySourcePath(sourcePath);
          }
          deletedExistingSources = true;
        }
        await storeWriter.upsert(batchEmbeddings);
        embeddedChunks.push(...batchEmbeddings);
      }
      this.progress.setEmbeddingProgress({
        chunksTotal: input.chunks.length,
        chunksEmbedded: embeddedChunks.length,
        embeddingBatchesTotal,
        embeddingBatchesCompleted: Math.floor(start / this.batchSize) + 1,
        currentFile: sourcePathForChunk(batch[0]),
      });

      await this.yieldToEventLoop();
    }

    return embeddedChunks;
  }

  private async ensureStoreInitialized(embeddingDimensions: number): Promise<void> {
    await this.indexStore.initialize({
      embeddingModel: this.embeddingModel,
      embeddingDimensions,
    });
  }

  private logPerformance(event: IndexingPerformanceLogEvent): void {
    this.logger?.logIndexingPerformance?.(event);
  }
}

function sourcePathForChunk(chunk: ExtractedChunk | undefined): string | undefined {
  const source = chunk?.source;
  if (!source) {
    return undefined;
  }

  switch (source.kind) {
    case "markdown":
    case "pdf":
    case "document":
      return source.path;
    case "web":
      return source.url;
  }
}

function textForEmbedding(chunk: ExtractedChunk): string {
  const source = chunk.source;

  switch (source.kind) {
    case "markdown":
      return [
        `File: ${source.path}`,
        source.headingPath.length > 0 ? `Heading: ${source.headingPath.join(" > ")}` : "",
        "",
        chunk.text,
      ]
        .filter((part) => part.length > 0)
        .join("\n");
    case "pdf":
      return [`File: ${source.path}`, `Page: ${source.pageNumber}`, "", chunk.text].join("\n");
    case "document":
      return [`File: ${source.path}`, `Format: ${source.format}`, "", chunk.text].join("\n");
    case "web":
      return [`Title: ${source.title}`, `URL: ${source.url}`, "", chunk.text].join("\n");
  }
}
