import { existsSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { LanceDbIndexStore } from "../../src/indexing/LanceDbIndexStore";
import { RealLanceDbDriver } from "../../src/indexing/RealLanceDbDriver";
import {
  LanceDbChunkRow,
  LanceDbConnection,
  LanceDbDriver,
  LanceDbMetadataRow,
  LanceDbTable,
} from "../../src/indexing/types";
import { EmbeddedChunk } from "../../src/shared/types";

function chunk(id: string, path: string, embedding: number[]): EmbeddedChunk {
  return {
    id,
    text: `text for ${id}`,
    contentHash: `hash-${id}`,
    embedding,
    embeddingModel: "nomic",
    source: {
      id: `source-${id}`,
      kind: "markdown",
      path,
      title: path,
      headingPath: [],
    },
  };
}

describe("LanceDbIndexStore", () => {
  let folder: string;
  let driver: FakeLanceDbDriver;
  let store: LanceDbIndexStore;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "ixplorer-lancedb-"));
    driver = new FakeLanceDbDriver();
    store = new LanceDbIndexStore({ folder, driver });
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("initializes metadata and creates LanceDB tables in the configured folder", async () => {
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });

    expect(driver.connectedFolder).toBe(folder);
    expect(driver.tableNames()).toEqual(["ixplorer_chunks", "ixplorer_metadata"]);
    expect(driver.metadataRows()).toEqual([
      { id: "metadata", key: "metadata", embeddingModel: "nomic", embeddingDimensions: 2 },
    ]);
  });

  it("upserts chunks and replaces existing rows with the same id", async () => {
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([chunk("one", "Research/a.md", [1, 0])]);
    await store.upsert([{ ...chunk("one", "Research/a.md", [0.5, 0.5]), text: "updated" }]);

    expect(driver.chunkRows()).toHaveLength(1);
    expect(driver.chunkRows()[0]).toMatchObject({
      id: "one",
      text: "updated",
      sourcePath: "Research/a.md",
      sourceJson: JSON.stringify(chunk("one", "Research/a.md", [0.5, 0.5]).source),
      vector: [0.5, 0.5],
    });
  });

  it("queries nearest chunks and maps rows back to retrieved chunks", async () => {
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("near", "Research/a.md", [1, 0]),
      chunk("far", "Research/b.md", [0, 1]),
    ]);

    await expect(store.query([1, 0], 1)).resolves.toEqual([
      expect.objectContaining({
        id: "near",
        text: "text for near",
        score: 1,
        source: expect.objectContaining({ kind: "markdown", path: "Research/a.md" }),
      }),
    ]);
  });

  it("deletes chunks by source path", async () => {
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("keep", "Research/a.md", [1, 0]),
      chunk("remove", "Research/b.md", [0, 1]),
    ]);
    await store.deleteBySourcePath("Research/b.md");

    expect(driver.chunkRows().map((row) => row.id)).toEqual(["keep"]);
  });

  it("clears indexed chunks without deleting metadata", async () => {
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([chunk("one", "Research/a.md", [1, 0])]);
    await store.clear();

    expect(driver.chunkRows()).toEqual([]);
    expect(driver.metadataRows()).toHaveLength(1);
  });

  it("requires a rebuild when stored embedding dimensions do not match", async () => {
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });

    await expect(
      store.initialize({ embeddingModel: "nomic", embeddingDimensions: 3 }),
    ).rejects.toMatchObject({ code: "INDEX_REBUILD_REQUIRED" });
  });

  it("rejects upserts and queries with the wrong embedding dimensions", async () => {
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });

    await expect(store.upsert([chunk("bad", "Research/a.md", [1, 2, 3])])).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
    });
    await expect(store.query([1, 2, 3], 1)).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
    });
  });

  it("persists and queries chunks with a real local LanceDB database", async () => {
    const realFolder = mkdtempSync(join(tmpdir(), "ixplorer-real-lancedb-"));

    try {
      const realStore = new LanceDbIndexStore({
        folder: realFolder,
        driver: new RealLanceDbDriver(),
      });
      await realStore.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
      await realStore.upsert([
        chunk("near-real", "Research/real-a.md", [1, 0]),
        chunk("far-real", "Research/real-b.md", [0, 1]),
      ]);

      expect(existsSync(realFolder)).toBe(true);
      expect(readdirSync(realFolder).length).toBeGreaterThan(0);
      await expect(realStore.query([1, 0], 1)).resolves.toEqual([
        expect.objectContaining({
          id: "near-real",
          source: expect.objectContaining({ kind: "markdown", path: "Research/real-a.md" }),
        }),
      ]);

      const reopenedStore = new LanceDbIndexStore({
        folder: realFolder,
        driver: new RealLanceDbDriver(),
      });
      await reopenedStore.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
      await expect(reopenedStore.query([1, 0], 2)).resolves.toEqual([
        expect.objectContaining({ id: "near-real" }),
        expect.objectContaining({ id: "far-real" }),
      ]);

      await reopenedStore.deleteBySourcePath("Research/real-a.md");
      await expect(reopenedStore.query([1, 0], 2)).resolves.toEqual([
        expect.objectContaining({ id: "far-real" }),
      ]);

      await reopenedStore.clear();
      await expect(reopenedStore.query([1, 0], 2)).resolves.toEqual([]);
    } finally {
      rmSync(realFolder, { recursive: true, force: true });
    }
  });
});

class FakeLanceDbDriver implements LanceDbDriver {
  connectedFolder = "";
  private readonly connection = new FakeLanceDbConnection();

  async connect(folder: string): Promise<LanceDbConnection> {
    this.connectedFolder = folder;
    return this.connection;
  }

  tableNames(): string[] {
    return this.connection.tableNames();
  }

  chunkRows(): LanceDbChunkRow[] {
    return this.connection.chunkRows();
  }

  metadataRows(): LanceDbMetadataRow[] {
    return this.connection.metadataRows();
  }
}

class FakeLanceDbConnection implements LanceDbConnection {
  private readonly tables = new Map<string, FakeLanceDbTable>();

  async openTable(name: string): Promise<LanceDbTable | null> {
    return this.tables.get(name) ?? null;
  }

  async createTable(
    name: string,
    rows: Array<LanceDbChunkRow | LanceDbMetadataRow>,
  ): Promise<LanceDbTable> {
    const table = new FakeLanceDbTable(rows);
    this.tables.set(name, table);
    return table;
  }

  tableNames(): string[] {
    return [...this.tables.keys()].sort();
  }

  chunkRows(): LanceDbChunkRow[] {
    return (this.tables.get("ixplorer_chunks")?.rows() ?? []) as LanceDbChunkRow[];
  }

  metadataRows(): LanceDbMetadataRow[] {
    return (this.tables.get("ixplorer_metadata")?.rows() ?? []) as LanceDbMetadataRow[];
  }
}

class FakeLanceDbTable implements LanceDbTable {
  private tableRows: Array<LanceDbChunkRow | LanceDbMetadataRow>;

  constructor(rows: Array<LanceDbChunkRow | LanceDbMetadataRow>) {
    this.tableRows = [...rows];
  }

  async add(rows: Array<LanceDbChunkRow | LanceDbMetadataRow>): Promise<void> {
    for (const row of rows) {
      this.tableRows = this.tableRows.filter((existing) => existing.id !== row.id);
      this.tableRows.push(row);
    }
  }

  async deleteById(id: string): Promise<void> {
    this.tableRows = this.tableRows.filter((row) => row.id !== id);
  }

  async deleteBySourcePath(sourcePath: string): Promise<void> {
    this.tableRows = this.tableRows.filter(
      (row) => !("sourcePath" in row) || row.sourcePath !== sourcePath,
    );
  }

  async clear(): Promise<void> {
    this.tableRows = [];
  }

  async all(): Promise<Array<LanceDbChunkRow | LanceDbMetadataRow>> {
    return this.rows();
  }

  search(vector: number[]): { limit(limit: number): { execute(): Promise<LanceDbChunkRow[]> } } {
    const rows = this.tableRows.filter((row): row is LanceDbChunkRow => "vector" in row);

    return {
      limit(limit: number) {
        return {
          async execute() {
            return rows
              .map((row) => ({ ...row, score: cosineSimilarity(vector, row.vector) }))
              .sort((left, right) => right.score - left.score)
              .slice(0, limit);
          },
        };
      },
    };
  }

  rows(): Array<LanceDbChunkRow | LanceDbMetadataRow> {
    return [...this.tableRows];
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  const leftMagnitude = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightMagnitude = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));

  return dot / (leftMagnitude * rightMagnitude);
}
