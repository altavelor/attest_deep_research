export interface DocumentReferenceNormalized {
  title?: string;
  year?: number;
  doi?: string;
}

export interface DocumentReference {
  raw: string;

  normalized?: DocumentReferenceNormalized;
}

export interface SourceDocumentMetadata {
  schemaVersion: 1;
  sourcePath: string;

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

export interface SharedReference {
  key: string;

  reference: string;
  doi?: string;
  citedBy: string[];
}

export interface DocumentMetadataStore {
  read(sourcePath: string): Promise<SourceDocumentMetadata | null>;
  write(metadata: SourceDocumentMetadata): Promise<void>;
  list(): Promise<SourceDocumentMetadata[]>;
}

export interface ExtractedDocumentMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  abstract?: string;

  references: string[];
}

export interface DocumentMetadataExtractionInput {
  sourcePath: string;

  headSample: string;

  referencesSample: string;
}

export interface DocumentMetadataExtractor {
  readonly model: string;
  readonly promptVersion: number;
  extract(input: DocumentMetadataExtractionInput): Promise<ExtractedDocumentMetadata>;
}
