import type { Connection, Table } from "@lancedb/lancedb";

import {
  LanceDbChunkRow,
  LanceDbConnection,
  LanceDbDriver,
  LanceDbMetadataRow,
  LanceDbSearchBuilder,
  LanceDbTable,
} from "./types";

type LanceDbRow = LanceDbChunkRow | LanceDbMetadataRow;

export class RealLanceDbDriver implements LanceDbDriver {
  async connect(folder: string): Promise<LanceDbConnection> {
    const lancedb = await import("@lancedb/lancedb");

    return new RealLanceDbConnection(await lancedb.connect(folder));
  }
}

class RealLanceDbConnection implements LanceDbConnection {
  constructor(private readonly connection: Connection) {}

  async openTable(name: string): Promise<LanceDbTable | null> {
    const tableNames = await this.connection.tableNames();

    if (!tableNames.includes(name)) {
      return null;
    }

    return new RealLanceDbTable(await this.connection.openTable(name));
  }

  async createTable(name: string, rows: LanceDbRow[]): Promise<LanceDbTable> {
    return new RealLanceDbTable(
      await this.connection.createTable(name, rows as unknown as Record<string, unknown>[]),
    );
  }
}

class RealLanceDbTable implements LanceDbTable {
  constructor(private readonly table: Table) {}

  async add(rows: LanceDbRow[]): Promise<void> {
    await this.table.add(rows as unknown as Record<string, unknown>[]);
  }

  async deleteById(id: string): Promise<void> {
    await this.table.delete(`id = ${sqlString(id)}`);
  }

  async deleteBySourcePath(sourcePath: string): Promise<void> {
    await this.table.delete(`sourcePath = ${sqlString(sourcePath)}`);
  }

  async clear(): Promise<void> {
    await this.table.delete("id IS NOT NULL");
  }

  async all(): Promise<LanceDbRow[]> {
    return (await this.table.query().toArray()) as LanceDbRow[];
  }

  search(vector: number[]): LanceDbSearchBuilder {
    const table = this.table;

    return {
      limit(limit: number) {
        return {
          async execute() {
            const rows = (await table.vectorSearch(vector).limit(limit).toArray()) as Array<
              LanceDbChunkRow & { _distance?: number }
            >;

            return rows.map(({ _distance, ...row }) => ({
              ...row,
              score: _distance === undefined ? row.score : 1 / (1 + _distance),
            }));
          },
        };
      },
    };
  }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
