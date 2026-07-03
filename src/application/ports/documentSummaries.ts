// Ports for hierarchical document summaries (SPEC-corpus-knowledge R4):
// per-section and per-document summaries generated during index enrichment and
// stored as sidecars next to the index.

export interface SectionSummary {
  headingPath: string[];
  chunkStart: number;
  chunkEnd: number;
  summary: string;
}

export interface SourceDocumentSummaries {
  schemaVersion: 1;
  sourcePath: string;
  /** contentHash of the source at generation time — drives incremental re-runs. */
  contentHash: string;
  sections: SectionSummary[];
  document: {
    summary: string;
    /** One sentence used in the corpus overview inside the agent prompt. */
    oneLiner: string;
  };
  generation: {
    model: string;
    promptVersion: number;
    generatedAt: string;
  };
}

export interface DocumentSummaryStore {
  read(sourcePath: string): Promise<SourceDocumentSummaries | null>;
  write(summaries: SourceDocumentSummaries): Promise<void>;
  list(): Promise<SourceDocumentSummaries[]>;
}

export interface SectionSummaryInput {
  sourcePath: string;
  headingPath: string[];
  text: string;
}

export interface DocumentSummaryInput {
  sourcePath: string;
  title?: string;
  /** Section summaries when the document has sections, otherwise a head sample. */
  sectionSummaries: string[];
}

export interface DocumentSummarizer {
  readonly model: string;
  readonly promptVersion: number;
  summarizeSection(input: SectionSummaryInput): Promise<string>;
  summarizeDocument(input: DocumentSummaryInput): Promise<{ summary: string; oneLiner: string }>;
}
