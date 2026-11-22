/** Writes exported research notes into the vault without ever replacing an existing file. */
export interface ResearchNoteWriter {
  exists(path: string): Promise<boolean>;
  ensureFolder(path: string): Promise<void>;
  createNew(path: string, content: string): Promise<boolean>;
}
