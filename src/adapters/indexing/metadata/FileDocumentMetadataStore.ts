// Sidecar storage for per-source document metadata (SPEC-corpus-knowledge R3):
// one JSON file per source under `<index folder>/metadata/`, named by a stable
// hash of the source path so any vault path is filename-safe.

import { createHash } from "crypto";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import { DocumentMetadataStore, SourceDocumentMetadata } from "@application/ports";

export class FileDocumentMetadataStore implements DocumentMetadataStore {
  constructor(private readonly folder: string) {}

  async read(sourcePath: string): Promise<SourceDocumentMetadata | null> {
    try {
      const raw = await readFile(this.fileFor(sourcePath), "utf8");
      const parsed: unknown = JSON.parse(raw);
      return isSourceDocumentMetadata(parsed) && parsed.sourcePath === sourcePath ? parsed : null;
    } catch {
      return null;
    }
  }

  async write(metadata: SourceDocumentMetadata): Promise<void> {
    await mkdir(this.metadataDir(), { recursive: true });
    await writeFile(this.fileFor(metadata.sourcePath), JSON.stringify(metadata, null, 2), "utf8");
  }

  async list(): Promise<SourceDocumentMetadata[]> {
    let files: string[];
    try {
      files = await readdir(this.metadataDir());
    } catch {
      return [];
    }

    const items: SourceDocumentMetadata[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(await readFile(join(this.metadataDir(), file), "utf8"));
        if (isSourceDocumentMetadata(parsed)) {
          items.push(parsed);
        }
      } catch {
        // Повреждённый sidecar не валит инвентарь — источник просто пере-обогатится.
      }
    }
    return items.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  }

  private metadataDir(): string {
    return join(this.folder, "metadata");
  }

  private fileFor(sourcePath: string): string {
    const id = createHash("sha256").update(sourcePath).digest("hex").slice(0, 32);
    return join(this.metadataDir(), `${id}.json`);
  }
}

function isSourceDocumentMetadata(value: unknown): value is SourceDocumentMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.sourcePath === "string" &&
    typeof record.contentHash === "string" &&
    Array.isArray(record.references) &&
    typeof record.extraction === "object" &&
    record.extraction !== null
  );
}
