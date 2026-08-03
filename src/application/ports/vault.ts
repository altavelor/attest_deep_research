export type { GraphContextProvider } from "@core/research";

export interface ContextFileProvider {
  listPaths(): Promise<string[]>;
  readFile(path: string): Promise<ArrayBuffer | string>;
  getModifiedTime?(path: string): Promise<number>;
  getSize?(path: string): Promise<number>;
}

export interface VaultFileSummary {
  path: string;
  modifiedTime: number;
  size?: number;
}

export interface VaultFileProvider {
  listFiles(): Promise<VaultFileSummary[]>;
  readFile(path: string): Promise<ArrayBuffer | string>;
}

export interface VaultWriter {
  exists(path: string): Promise<boolean>;
  createFile(path: string, content: string): Promise<void>;

  createBinaryFile(path: string, data: Uint8Array): Promise<void>;
  modifyFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  trashFile(path: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}
