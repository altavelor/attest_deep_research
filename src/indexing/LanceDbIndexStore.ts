import { mkdir } from "fs/promises";

import { IxplorerError } from "../shared/errors";
import {
  EmbeddedChunk,
  IndexStore,
  IndexStoreMetadata,
  RetrievedChunk,
  SourceReference,
} from "../shared/types";
import {
  LanceDbChunkRow,
  LanceDbConnection,
  LanceDbDriver,
  LanceDbMetadataRow,
  LanceDbTable,
} from "./types";

export interface LanceDbIndexStoreOptions {
  folder: string;
  driver: LanceDbDriver;
  chunksTableName?: string;
  metadataTableName?: string;
}

const DEFAULT_CHUNKS_TABLE_NAME = "ixplorer_chunks";
const DEFAULT_METADATA_TABLE_NAME = "ixplorer_metadata";
const METADATA_ROW_ID = "metadata";
const SEED_CHUNK_ROW_ID = "__ixplorer_schema_seed__";

export class LanceDbIndexStore implements IndexStore {
  private readonly folder: string;
  private readonly driver: LanceDbDriver;
  private readonly chunksTableName: string;
  private readonly metadataTableName: string;
  private connection: LanceDbConnection | null = null;
  private chunksTable: LanceDbTable | null = null;
  private metadataTable: LanceDbTable | null = null;
  private metadata: IndexStoreMetadata | null = null;

  constructor(options: LanceDbIndexStoreOptions) {
    this.folder = options.folder;
    this.driver = options.driver;
    this.chunksTableName = options.chunksTableName ?? DEFAULT_CHUNKS_TABLE_NAME;
    this.metadataTableName = options.metadataTableName ?? DEFAULT_METADATA_TABLE_NAME;
  }

  async initialize(metadata: IndexStoreMetadata): Promise<void> {
    try {
      await mkdir(this.folder, { recursive: true });
      this.connection = await this.driver.connect(this.folder);
      this.metadataTable = await this.ensureMetadataTable(metadata);
      this.metadata = await this.readAndValidateMetadata(metadata);
      this.chunksTable = await this.ensureChunksTable();
    } catch (error) {
      if (error instanceof IxplorerError) {
        throw error;
      }

      throw new IxplorerError({
        code: "INDEX_UNAVAILABLE",
        message: "The LanceDB index store could not be initialized.",
        cause: error,
        details: { folder: this.folder },
      });
    }
  }

  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    const table = this.requireChunksTable();
    const metadata = this.requireMetadata();

    for (const chunk of chunks) {
      this.assertEmbeddingDimensions(chunk.embedding, metadata.embeddingDimensions);
      await table.deleteById(chunk.id);
    }

    if (chunks.length === 0) {
      return;
    }

    await table.add(chunks.map((chunk) => toChunkRow(chunk)));
  }

  async deleteBySourcePath(path: string): Promise<void> {
    const table = await this.openExistingChunksTable();

    if (!table) {
      return;
    }

    await table.deleteBySourcePath(path);
  }

  async clear(): Promise<void> {
    const table = await this.openExistingChunksTable();

    if (!table) {
      return;
    }

    await table.clear();
  }

  async query(embedding: number[], limit: number): Promise<RetrievedChunk[]> {
    const metadata = this.requireMetadata();
    this.assertEmbeddingDimensions(embedding, metadata.embeddingDimensions);

    const rows = await this.requireChunksTable().search(embedding).limit(limit).execute();

    return rows.map((row) => ({
      id: row.id,
      source: readSource(row.sourceJson),
      text: row.text,
      contentHash: row.contentHash,
      score: row.score ?? 0,
    }));
  }

  private async ensureMetadataTable(metadata: IndexStoreMetadata): Promise<LanceDbTable> {
    const existing = await this.requireConnection().openTable(this.metadataTableName);

    if (existing) {
      return existing;
    }

    return this.requireConnection().createTable(this.metadataTableName, [toMetadataRow(metadata)]);
  }

  private async openExistingChunksTable(): Promise<LanceDbTable | null> {
    if (this.chunksTable) {
      return this.chunksTable;
    }

    await mkdir(this.folder, { recursive: true });
    this.connection = this.connection ?? (await this.driver.connect(this.folder));
    this.chunksTable = await this.requireConnection().openTable(this.chunksTableName);

    return this.chunksTable;
  }

  private async ensureChunksTable(): Promise<LanceDbTable> {
    const existing = await this.requireConnection().openTable(this.chunksTableName);

    if (existing) {
      return existing;
    }

    const table = await this.requireConnection().createTable(this.chunksTableName, [
      createSeedChunkRow(this.requireMetadata().embeddingDimensions),
    ]);
    await table.deleteById(SEED_CHUNK_ROW_ID);

    return table;
  }

  private async readAndValidateMetadata(metadata: IndexStoreMetadata): Promise<IndexStoreMetadata> {
    const rows = (await this.requireMetadataTable().all()).filter(isMetadataRow);
    const existing = rows.find((row) => row.id === METADATA_ROW_ID);

    if (!existing) {
      await this.requireMetadataTable().add([toMetadataRow(metadata)]);
      return metadata;
    }

    if (
      existing.embeddingModel !== metadata.embeddingModel ||
      existing.embeddingDimensions !== metadata.embeddingDimensions
    ) {
      throw new IxplorerError({
        code: "INDEX_REBUILD_REQUIRED",
        message: "The LanceDB index was built for different embedding metadata.",
        details: {
          storedEmbeddingModel: existing.embeddingModel,
          storedEmbeddingDimensions: existing.embeddingDimensions,
          requestedEmbeddingModel: metadata.embeddingModel,
          requestedEmbeddingDimensions: metadata.embeddingDimensions,
        },
      });
    }

    return {
      embeddingModel: existing.embeddingModel,
      embeddingDimensions: existing.embeddingDimensions,
    };
  }

  private assertEmbeddingDimensions(embedding: number[], expectedDimensions: number): void {
    if (embedding.length !== expectedDimensions) {
      throw new IxplorerError({
        code: "INDEX_REBUILD_REQUIRED",
        message: "The embedding dimensions do not match the local search index.",
        details: {
          expectedDimensions,
          actualDimensions: embedding.length,
        },
      });
    }
  }

  private requireConnection(): LanceDbConnection {
    if (!this.connection) {
      throw new IxplorerError({
        code: "INDEX_UNAVAILABLE",
        message: "The LanceDB connection has not been initialized.",
      });
    }

    return this.connection;
  }

  private requireChunksTable(): LanceDbTable {
    if (!this.chunksTable) {
      throw new IxplorerError({
        code: "INDEX_UNAVAILABLE",
        message: "The LanceDB chunks table has not been initialized.",
      });
    }

    return this.chunksTable;
  }

  private requireMetadataTable(): LanceDbTable {
    if (!this.metadataTable) {
      throw new IxplorerError({
        code: "INDEX_UNAVAILABLE",
        message: "The LanceDB metadata table has not been initialized.",
      });
    }

    return this.metadataTable;
  }

  private requireMetadata(): IndexStoreMetadata {
    if (!this.metadata) {
      throw new IxplorerError({
        code: "INDEX_UNAVAILABLE",
        message: "The LanceDB index metadata has not been initialized.",
      });
    }

    return this.metadata;
  }
}

function toChunkRow(chunk: EmbeddedChunk): LanceDbChunkRow {
  return {
    id: chunk.id,
    vector: chunk.embedding,
    text: chunk.text,
    contentHash: chunk.contentHash,
    sourceJson: JSON.stringify(chunk.source),
    sourcePath: sourcePath(chunk.source),
    embeddingModel: chunk.embeddingModel,
  };
}

function toMetadataRow(metadata: IndexStoreMetadata): LanceDbMetadataRow {
  return {
    id: METADATA_ROW_ID,
    key: "metadata",
    embeddingModel: metadata.embeddingModel,
    embeddingDimensions: metadata.embeddingDimensions,
  };
}

function createSeedChunkRow(embeddingDimensions: number): LanceDbChunkRow {
  return {
    id: SEED_CHUNK_ROW_ID,
    vector: Array.from({ length: embeddingDimensions }, () => 0),
    text: "",
    contentHash: "",
    sourceJson: JSON.stringify({
      id: SEED_CHUNK_ROW_ID,
      kind: "markdown",
      path: "",
      title: "",
      headingPath: [],
    }),
    sourcePath: "",
    embeddingModel: "",
  };
}

function sourcePath(source: SourceReference): string | undefined {
  return "path" in source ? source.path : undefined;
}

function isMetadataRow(row: LanceDbChunkRow | LanceDbMetadataRow): row is LanceDbMetadataRow {
  return "key" in row && row.key === "metadata";
}

function readSource(sourceJson: string): SourceReference {
  return JSON.parse(sourceJson) as SourceReference;
}
