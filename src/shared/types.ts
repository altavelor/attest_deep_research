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
}

export interface Citation {
  id: string;
  source: SourceReference;
  label: string;
}

export type LanguageCode = string;

export interface LanguageInventoryItem {
  language: LanguageCode;
  chunkCount: number;
  sourceCount: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponseChunk {
  content: string;
  isComplete: boolean;
}

export type ApiFormat = "openai-compatible" | "ollama" | "anthropic";
export type LocalModelProvider = ApiFormat;

export interface ChatModelProvider {
  listModels(): Promise<string[]>;
  streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk>;
}

export interface EmbeddingRequest {
  model: string;
  input: string[];
}

export interface EmbeddingResponse {
  model: string;
  embeddings: number[][];
}

export interface EmbeddingProviderClient {
  listModels(): Promise<string[]>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface ExtractorInput {
  path: string;
  data: ArrayBuffer | string;
  modifiedTime: number;
}

export interface Extractor {
  supports(path: string): boolean;
  extract(input: ExtractorInput): Promise<ExtractedChunk[]>;
}

export interface IndexStoreMetadata {
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface IndexStore {
  initialize(metadata: IndexStoreMetadata): Promise<void>;
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  deleteBySourcePath(path: string): Promise<void>;
  clear(): Promise<void>;
  query(embedding: number[], limit: number): Promise<RetrievedChunk[]>;
  beginWrite?(): Promise<IndexStoreWriteSession>;
}

export interface IndexStoreWriteSession {
  upsert(chunks: EmbeddedChunk[]): Promise<void>;
  deleteBySourcePath(path: string): Promise<void>;
  updateSourceSnapshots?(snapshots: IndexSourceSnapshot[]): Promise<void>;
  recordFailedSourceSnapshots?(snapshots: IndexFailedSourceSnapshot[]): Promise<void>;
  commit(): Promise<void>;
  rollback(): void;
}

export interface IndexSourceSnapshot {
  sourcePath: string;
  modifiedTime: number;
  contentHash: string;
  languages?: LanguageCode[];
}

export interface IndexFailedSourceSnapshot {
  sourcePath: string;
  modifiedTime: number;
  errorMessage: string;
  indexedAt: string;
}

export interface SourceSnapshotIndexStore {
  loadSourceSnapshots(): Promise<IndexSourceSnapshot[]>;
  updateSourceSnapshots(snapshots: IndexSourceSnapshot[]): Promise<void>;
  recordFailedSourceSnapshots?(snapshots: IndexFailedSourceSnapshot[]): Promise<void>;
}

export interface LanguageInventoryIndexStore {
  getLanguageInventory(): Promise<LanguageInventoryItem[]>;
}

export interface RetrievalOptions {
  limit: number;
  includeWebResults: boolean;
  minScore?: number;
  sourceKinds?: SourceKind[];
  fileExtensions?: string[];
  sourcePaths?: string[];
  queryVariants?: RetrievalQueryVariant[];
}

export interface RetrievalQueryVariant {
  query: string;
  language?: LanguageCode;
  reason?: "original" | "expanded" | "translated";
}

export interface KeywordSearchIndexStore {
  searchKeywords(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}

export interface AdjacentChunkIndexStore {
  expandAdjacentChunks(
    chunks: RetrievedChunk[],
    radius: number,
    limit: number,
  ): Promise<RetrievedChunk[]>;
}

export interface Retriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}

export interface SearchProviderResult {
  source: WebSourceReference;
  extractedText?: string;
  rank: number;
  query: string;
}

export interface WebSearchOptions {
  limit?: number;
  maxFetches?: number;
  timeoutMs?: number;
}

export interface SearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<SearchProviderResult[]>;
}

export interface ResearchAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  evidence?: RetrievedChunk[];
  followUpQuestions: string[];
  createdAt: string;
}
