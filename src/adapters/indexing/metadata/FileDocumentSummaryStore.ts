// Sidecar storage for hierarchical document summaries (SPEC-corpus R4):
// one JSON file per source under `<index folder>/summaries/`.

import { DocumentSummaryStore, SourceDocumentSummaries } from "@application/ports";
import { JsonSidecarStore } from "./JsonSidecarStore";

export class FileDocumentSummaryStore implements DocumentSummaryStore {
  private readonly store: JsonSidecarStore<SourceDocumentSummaries>;

  constructor(folder: string) {
    this.store = new JsonSidecarStore(folder, "summaries", isSourceDocumentSummaries);
  }

  read(sourcePath: string): Promise<SourceDocumentSummaries | null> {
    return this.store.read(sourcePath);
  }

  write(summaries: SourceDocumentSummaries): Promise<void> {
    return this.store.write(summaries);
  }

  list(): Promise<SourceDocumentSummaries[]> {
    return this.store.list();
  }
}

function isSourceDocumentSummaries(value: unknown): value is SourceDocumentSummaries {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const document = record.document as Record<string, unknown> | undefined;
  return (
    record.schemaVersion === 1 &&
    typeof record.sourcePath === "string" &&
    typeof record.contentHash === "string" &&
    Array.isArray(record.sections) &&
    typeof document === "object" &&
    document !== null &&
    typeof document.summary === "string" &&
    typeof document.oneLiner === "string"
  );
}
