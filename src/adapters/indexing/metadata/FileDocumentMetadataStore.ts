// Sidecar storage for per-source document metadata (SPEC-corpus-knowledge R3):
// one JSON file per source under `<index folder>/metadata/`.

import { DocumentMetadataStore, SourceDocumentMetadata } from "@application/ports";
import { JsonSidecarStore } from "./JsonSidecarStore";

export class FileDocumentMetadataStore implements DocumentMetadataStore {
  private readonly store: JsonSidecarStore<SourceDocumentMetadata>;

  constructor(folder: string) {
    this.store = new JsonSidecarStore(folder, "metadata", isSourceDocumentMetadata);
  }

  read(sourcePath: string): Promise<SourceDocumentMetadata | null> {
    return this.store.read(sourcePath);
  }

  write(metadata: SourceDocumentMetadata): Promise<void> {
    return this.store.write(metadata);
  }

  list(): Promise<SourceDocumentMetadata[]> {
    return this.store.list();
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
