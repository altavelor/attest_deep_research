// Core domain model: source references and chunks.
// Platform-neutral: no imports from obsidian, DOM, fs, or other layers.

export type SourceKind = "markdown" | "pdf" | "document" | "web";

export type DocumentFormat = "fb2" | "epub" | "txt" | "docx";

export interface SourceReferenceBase {
  id: string;
  kind: SourceKind;
  title: string;
}

export interface MarkdownSourceReference extends SourceReferenceBase {
  kind: "markdown";
  path: string;
  headingPath: string[];
  blockId?: string;
  startOffset?: number;
  endOffset?: number;
}

export interface PdfSourceReference extends SourceReferenceBase {
  kind: "pdf";
  path: string;
  pageNumber: number;
  startOffset?: number;
  endOffset?: number;
  /** Section path from the PDF outline or typography heuristics; absent in older indexes. */
  headingPath?: string[];
}

export interface DocumentSourceReference extends SourceReferenceBase {
  kind: "document";
  path: string;
  format: DocumentFormat;
  startOffset?: number;
  endOffset?: number;
}

export interface WebSourceReference extends SourceReferenceBase {
  kind: "web";
  url: string;
  snippet: string;
  retrievedAt: string;
  wasContentFetched: boolean;
}

export type SourceReference =
  | MarkdownSourceReference
  | PdfSourceReference
  | DocumentSourceReference
  | WebSourceReference;

export interface ExtractedChunk {
  id: string;
  source: SourceReference;
  text: string;
  contentHash: string;
}

export interface EmbeddedChunk extends ExtractedChunk {
  embedding: number[];
  embeddingModel: string;
}

export interface RetrievedChunk extends ExtractedChunk {
  score: number;
  /** Retrieval-time near-duplicate annotation (SPEC-corpus R8): sourcePaths of
   * suppressed near-duplicate copies this chunk stands in for. */
  duplicates?: readonly string[];
}

/** Deduplicate chunks by `id`, preserving first-seen order. */
export function uniqueChunks<T extends { id: string }>(chunks: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const chunk of chunks) {
    if (seen.has(chunk.id)) {
      continue;
    }

    seen.add(chunk.id);
    unique.push(chunk);
  }

  return unique;
}
