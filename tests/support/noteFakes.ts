import { ContextFileProvider } from "@application/ports";

/** Serves vault notes from an in-memory path-to-text map; unknown paths read as empty text. */
export class MemoryContextFiles implements ContextFileProvider {
  constructor(private readonly files: Record<string, string>) {}

  async listPaths(): Promise<string[]> {
    return Object.keys(this.files).sort();
  }

  async readFile(path: string): Promise<string> {
    return this.files[path] ?? "";
  }
}
