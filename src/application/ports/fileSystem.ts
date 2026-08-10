export type FileSystemEntryKind = "file" | "folder";

export interface FileSystemEntry {
  path: string;
  name: string;
  kind: FileSystemEntryKind;
}

export interface FileSystemStat {
  kind: FileSystemEntryKind;
  size: number;
  modifiedTime: number;
}

/**
 * Vault-relative file storage used by the indexing and chat stores. Paths are
 * always relative to the vault root and use forward slashes, so a single
 * implementation serves desktop and mobile alike.
 */
export interface FileSystemPort {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileSystemStat | null>;
  list(path: string): Promise<FileSystemEntry[]>;
  createFolder(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  readTextLines(path: string): AsyncIterable<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeText(path: string, content: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  append(path: string, content: string): Promise<void>;
  rename(fromPath: string, toPath: string): Promise<void>;
  remove(path: string): Promise<void>;
  removeFolder(path: string, options?: { recursive?: boolean }): Promise<void>;
}
