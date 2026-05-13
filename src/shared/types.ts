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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatResponseChunk {
  content: string;
  isComplete: boolean;
}

export interface ChatModelClient {
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

export interface EmbeddingClient {
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
}

export interface RetrievalOptions {
  limit: number;
  includeWebResults: boolean;
}

export interface Retriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}

export interface SearchProviderResult {
  source: WebSourceReference;
  extractedText?: string;
}

export interface SearchProvider {
  searchFirstResult(query: string): Promise<SearchProviderResult | null>;
}

export interface ResearchAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  followUpQuestions: string[];
  createdAt: string;
}
