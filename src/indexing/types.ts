export interface LanceDbChunkRow {
  id: string;
  vector: number[];
  text: string;
  contentHash: string;
  sourceJson: string;
  sourcePath?: string;
  embeddingModel: string;
  score?: number;
}

export interface LanceDbMetadataRow {
  id: string;
  key: "metadata";
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface LanceDbSearchBuilder {
  limit(limit: number): {
    execute(): Promise<LanceDbChunkRow[]>;
  };
}

export interface LanceDbTable {
  add(rows: Array<LanceDbChunkRow | LanceDbMetadataRow>): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteBySourcePath(sourcePath: string): Promise<void>;
  clear(): Promise<void>;
  all(): Promise<Array<LanceDbChunkRow | LanceDbMetadataRow>>;
  search(vector: number[]): LanceDbSearchBuilder;
}

export interface LanceDbConnection {
  openTable(name: string): Promise<LanceDbTable | null>;
  createTable(
    name: string,
    rows: Array<LanceDbChunkRow | LanceDbMetadataRow>,
  ): Promise<LanceDbTable>;
}

export interface LanceDbDriver {
  connect(folder: string): Promise<LanceDbConnection>;
}
