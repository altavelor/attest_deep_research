export interface SectionSummary {
  headingPath: string[];
  chunkStart: number;
  chunkEnd: number;

  sectionHash?: string;
  summary: string;
}

export interface SourceDocumentSummaries {
  schemaVersion: 1;
  sourcePath: string;

  contentHash: string;
  sections: SectionSummary[];
  document: {
    summary: string;

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

  sectionSummaries: string[];
}

export interface DocumentSummarizer {
  readonly model: string;
  readonly promptVersion: number;
  summarizeSection(input: SectionSummaryInput): Promise<string>;
  summarizeDocument(input: DocumentSummaryInput): Promise<{ summary: string; oneLiner: string }>;
}
