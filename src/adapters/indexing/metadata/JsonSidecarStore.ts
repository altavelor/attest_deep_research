// Generic per-source JSON sidecar storage under the index folder: one file per
// source, named by a stable hash of the source path (filename-safe for any
// vault path). Shared by the metadata and summary stores (SPEC-corpus R3/R4).

import { createHash } from "crypto";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

export class JsonSidecarStore<T extends { sourcePath: string }> {
  constructor(
    private readonly folder: string,
    private readonly subdirectory: string,
    private readonly isValid: (value: unknown) => value is T,
  ) {}

  async read(sourcePath: string): Promise<T | null> {
    try {
      const raw = await readFile(this.fileFor(sourcePath), "utf8");
      const parsed: unknown = JSON.parse(raw);
      return this.isValid(parsed) && parsed.sourcePath === sourcePath ? parsed : null;
    } catch {
      return null;
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    await writeFile(this.fileFor(value.sourcePath), JSON.stringify(value, null, 2), "utf8");
  }

  async list(): Promise<T[]> {
    let files: string[];
    try {
      files = await readdir(this.dir());
    } catch {
      return [];
    }

    const items: T[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(await readFile(join(this.dir(), file), "utf8"));
        if (this.isValid(parsed)) {
          items.push(parsed);
        }
      } catch {
        // Повреждённый sidecar не валит инвентарь — источник просто пере-обогатится.
      }
    }
    return items.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  }

  private dir(): string {
    return join(this.folder, this.subdirectory);
  }

  private fileFor(sourcePath: string): string {
    const id = createHash("sha256").update(sourcePath).digest("hex").slice(0, 32);
    return join(this.dir(), `${id}.json`);
  }
}
