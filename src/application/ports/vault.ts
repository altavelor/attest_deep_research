// Vault ports (SPEC R4). The application's neutral view of the vault; concrete
// implementations live in adapters (adapters/obsidian, or any other runtime).
// Everything crosses the boundary as path-strings and normalized DTOs — never
// Obsidian's TFile/Vault. GraphContextProvider is owned by core (the pure graph
// logic depends on it) and re-exported here so all vault ports share one surface.

export type { GraphContextProvider } from "@core/research";

/** Read access to vault documents (VaultContentPort). */
export interface ContextFileProvider {
  listPaths(): Promise<string[]>;
  readFile(path: string): Promise<ArrayBuffer | string>;
  getModifiedTime?(path: string): Promise<number>;
  getSize?(path: string): Promise<number>;
}

/** Bulk file enumeration for indexing. */
export interface VaultFileSummary {
  path: string;
  modifiedTime: number;
  size?: number;
}

export interface VaultFileProvider {
  listFiles(): Promise<VaultFileSummary[]>;
  readFile(path: string): Promise<ArrayBuffer | string>;
}

/** Write access to the vault (VaultWritePort). */
export interface VaultWriter {
  exists(path: string): Promise<boolean>;
  createFile(path: string, content: string): Promise<void>;
  modifyFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  trashFile(path: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}
