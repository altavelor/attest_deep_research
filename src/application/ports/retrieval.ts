import { RetrievedChunk, SourceReference } from "@core/model";
import { RetrievalOptions } from "@core/retrieval";

export interface IndexCursorPage<T> {
  items: T[];
  nextCursor?: string;
  /** Total number of matches before pagination (cheap to compute; lets callers report breadth). */
  totalCount?: number;
}

export interface IndexSourceInventoryOptions {
  cursor?: string;
  limit: number;
  kind?: SourceReference["kind"];
  pathPrefix?: string;
  query?: string;
}

export interface IndexSourceInventoryItem {
  sourcePath: string;
  title: string;
  kind: SourceReference["kind"];
  modifiedTime: number;
  indexedAt: string;
  chunkCount: number;
  languages?: string[];
  /** Hash of the source content at indexing time; drives incremental enrichment. */
  contentHash?: string;
}

export interface IndexChunkListOptions {
  sourcePath: string;
  cursor?: string;
  limit: number;
  headingPath?: string[];
}

export interface IndexChunkListItem {
  chunkId: string;
  sourcePath: string;
  chunkIndex: number;
  title: string;
  headingPath?: string[];
  textPreview: string;
  charCount: number;
  source: SourceReference;
}

export interface IndexChunkReadOptions {
  chunkId: string;
  before: number;
  after: number;
  maxChars: number;
}

export interface IndexChunkReadResult {
  chunks: Array<{
    chunkId: string;
    sourcePath: string;
    chunkIndex: number;
    text: string;
    charCount: number;
    truncated: boolean;
    source: SourceReference;
  }>;
}

export interface IndexSectionReadOptions {
  chunkId: string;
  maxChars: number;
  cursor?: string;
}

export interface IndexSectionReadResult {
  /** Section identity: heading path of the section (empty for heuristic runs). */
  headingPath: string[];
  sourcePath: string;
  /** chunkIndex range of the whole section, before pagination. */
  chunkStart: number;
  chunkEnd: number;
  chunks: IndexChunkReadResult["chunks"];
  nextCursor?: string;
}

export interface FindInIndexOptions {
  pattern: string;
  mode: "literal" | "regex";
  sourcePath?: string;
  caseSensitive?: boolean;
  cursor?: string;
  limit: number;
  /** Caller intent only: return just the total count, not the matches. */
  countOnly?: boolean;
}

export interface FindInIndexMatch {
  id: string;
  chunkId: string;
  sourcePath: string;
  chunkIndex: number;
  start: number;
  end: number;
  match: string;
  context: string;
  source: SourceReference;
}

export interface IndexSectionOutline {
  headingPath: string[];
  title: string;
  level: number;
  chunkStart: number;
  chunkEnd: number;
  chunkCount: number;
  charCount: number;
}

export interface IndexSourceOutline {
  sourcePath: string;
  title: string;
  kind: SourceReference["kind"];
  chunkCount: number;
  charCount: number;
  sections: IndexSectionOutline[];
}

export interface IndexSourceSummary extends IndexSourceOutline {
  topics: Array<{ term: string; count: number }>;
}

export interface IndexMetadataSearchOptions {
  sourceKind?: SourceReference["kind"];
  pathPrefix?: string;
  extension?: string;
  title?: string;
  heading?: string;
  indexedAfter?: string;
  language?: string;
  cursor?: string;
  limit: number;
  /** Caller intent only: return just the total count, not the matched sources. */
  countOnly?: boolean;
}

export interface KeywordSearchIndexStore {
  searchKeywords(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}

export interface IndexInventoryStore {
  listIndexSources(
    options: IndexSourceInventoryOptions,
  ): Promise<IndexCursorPage<IndexSourceInventoryItem>>;
  listIndexChunks(options: IndexChunkListOptions): Promise<IndexCursorPage<IndexChunkListItem>>;
  readIndexChunk(options: IndexChunkReadOptions): Promise<IndexChunkReadResult>;
  readIndexSection(options: IndexSectionReadOptions): Promise<IndexSectionReadResult | null>;
  findInIndex(options: FindInIndexOptions): Promise<IndexCursorPage<FindInIndexMatch>>;
  summarizeIndexSource(sourcePath: string, maxSections: number): Promise<IndexSourceSummary | null>;
  getIndexSourceOutline(sourcePath: string): Promise<IndexSourceOutline | null>;
  searchIndexByMetadata(
    options: IndexMetadataSearchOptions,
  ): Promise<IndexCursorPage<IndexSourceInventoryItem>>;
}

export interface Retriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}
