// Ports for the index enrichment layer (SPEC-corpus-knowledge R3): per-source
// document metadata (bibliography) extracted once at indexing time and stored
// as sidecars next to the index.

export interface DocumentReferenceNormalized {
  title?: string;
  year?: number;
  doi?: string;
}

export interface DocumentReference {
  /** The reference string as it appears in the document. */
  raw: string;
  /** Best-effort normalization used to match references across documents. */
  normalized?: DocumentReferenceNormalized;
}

export interface SourceDocumentMetadata {
  schemaVersion: 1;
  sourcePath: string;
  /** contentHash of the source at extraction time — drives incremental re-enrichment. */
  contentHash: string;
  title?: string;
  authors?: string[];
  year?: number;
  abstract?: string;
  references: DocumentReference[];
  extraction: {
    model: string;
    promptVersion: number;
    extractedAt: string;
  };
}

/** A reference cited by several indexed documents (the "shared sources" view). */
export interface SharedReference {
  /** Matching key: DOI when known, otherwise normalized title(+year). */
  key: string;
  /** A representative raw reference string. */
  reference: string;
  doi?: string;
  citedBy: string[];
}

export interface DocumentMetadataStore {
  read(sourcePath: string): Promise<SourceDocumentMetadata | null>;
  write(metadata: SourceDocumentMetadata): Promise<void>;
  list(): Promise<SourceDocumentMetadata[]>;
}

/** Raw fields an extractor (LLM-backed in adapters) pulls out of document samples. */
export interface ExtractedDocumentMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  abstract?: string;
  /** Reference strings verbatim; normalization happens in the application layer. */
  references: string[];
}

export interface DocumentMetadataExtractionInput {
  sourcePath: string;
  /** Text from the head of the document (title page, abstract). */
  headSample: string;
  /** Text likely to contain the bibliography (references section or document tail). */
  referencesSample: string;
}

export interface DocumentMetadataExtractor {
  /** Model identifier recorded into extraction provenance. */
  readonly model: string;
  readonly promptVersion: number;
  extract(input: DocumentMetadataExtractionInput): Promise<ExtractedDocumentMetadata>;
}
