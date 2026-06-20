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

export type ContextMode = "include" | "filter";

export type ContextSourceRole =
  | "attached"
  | "mention"
  | "active"
  | "question"
  | "retrieval"
  | "graph"
  | "web";

export interface ContextDiagnosticSource {
  path: string;
  role: ContextSourceRole;
  status: "included" | "filtered" | "dropped" | "missing" | "unsupported" | "failed";
  chunkCount?: number;
  includedTokens?: number;
  droppedTokens?: number;
  reason?: string;
}

export interface ContextBudgetGroup {
  name: "history" | "explicit" | "graph" | "retrieval" | "web" | "reserved-output";
  usedTokens: number;
  droppedItems: number;
  allocatedTokens?: number;
  includedItems?: number;
}

export interface EvidencePlannerDiagnostics {
  webIntent: {
    detected: boolean;
    reason: "explicit-web" | "web-only" | "freshness-keyword" | "none";
    matchedTerms: string[];
  };
  localEvidenceQuality: {
    weak: boolean;
    explicitChunks: number;
    graphChunks: number;
    retrievalChunks: number;
    averageRetrievalScore?: number;
    reasons: string[];
  };
  budget: {
    policy: "local-first" | "freshness" | "weak-local" | "web-only" | "index-only";
    evidenceLimit: number;
    contextLimitTokens?: number;
    reservedOutputTokens?: number;
    groups: ContextBudgetGroup[];
  };
  dropped: {
    explicitChunkIds: string[];
    graphChunkIds: string[];
    retrievalChunkIds: string[];
    webChunkIds: string[];
  };
  expandedCitations: {
    citationKeys: string[];
    addedChunkIds: string[];
  };
}

export type GraphEdgeType = "forward_link" | "embed" | "backlink" | "question_link";

export interface ContextGraphEdgeDiagnostic {
  from: string;
  to: string;
  type: GraphEdgeType;
  depth: number;
}

export interface ContextGraphCandidateDiagnostic {
  path: string;
  status: "included" | "dropped" | "unresolved" | "unsupported";
  reason?: string;
  score?: number;
  edges: ContextGraphEdgeDiagnostic[];
}

export interface ContextGraphDiagnostics {
  enabled: boolean;
  source: "metadataCache" | "parserFallback" | "mixed" | "none";
  depth: number;
  rootPaths: string[];
  included: ContextGraphCandidateDiagnostic[];
  dropped: ContextGraphCandidateDiagnostic[];
  unresolved: ContextGraphCandidateDiagnostic[];
  limits: {
    maxForwardLinksPerRoot: number;
    maxEmbedsPerRoot: number;
    maxBacklinksPerRoot: number;
    maxGraphCandidatesTotal: number;
  };
}

export interface ContextDiagnostics {
  executionStrategy?: ResearchExecutionStrategy;
  contextMode: ContextMode;
  explicitSources: ContextDiagnosticSource[];
  mentionSources: ContextDiagnosticSource[];
  activeSources: ContextDiagnosticSource[];
  graph: ContextGraphDiagnostics;
  retrieval: {
    queryVariants: string[];
    includedChunkIds: string[];
    droppedChunkIds: string[];
    filteredSourcePaths: string[];
    rankedChunks?: RetrievalChunkDiagnostic[];
  };
  budget: {
    limitTokens?: number;
    usedTokens: number;
    reservedOutputTokens?: number;
    groups: ContextBudgetGroup[];
  };
  evidencePlanner?: EvidencePlannerDiagnostics;
  web?: WebContextDiagnostics;
  index?: ContextIndexDiagnostics;
  indexDescription?: IndexDescriptionPromptDiagnostics;
  skills?: SkillContextDiagnostics;
  tools: ToolCallDiagnostic[];
  warnings: string[];
  agentic?: AgenticAttemptDiagnostics;
}

export interface AgenticAttemptDiagnostics {
  policyReason: string;
  requiredTools: string[];
  satisfiedTools: string[];
  repairedTools: string[];
  rounds: number;
  totalCalls: number;
  duplicateCalls: number;
  fallbackReason?: string;
  duplicatedCost: boolean;
  capabilityProvenance?: Record<string, string>;
  unknownCitationIds?: string[];
  phases?: string[];
  stopReasons?: string[];
  budgets?: {
    maxRounds: number;
    maxCallsPerRound: number;
    maxTotalCalls: number;
    maxResultChars: number;
    usedResultChars: number;
  };
}

export interface IndexDescriptionPromptDiagnostics {
  freshness: "current" | "stale" | "failed" | "missing";
  textHash: string;
  algorithmVersion: number;
  generatedAt: string;
  indexUpdatedAt: string;
  representativeChunkCount: number;
  truncated: boolean;
  usedFallback: boolean;
  failureReason?: string;
}

export interface IndexDescriptionPromptContext {
  text: string;
  diagnostics: IndexDescriptionPromptDiagnostics;
}

export type ResearchExecutionStrategy =
  | "eager-forced"
  | "eager-default"
  | "agentic"
  | "deterministic-fallback";

export interface WebContextDiagnostics {
  originalQuestion: string;
  queryStrategy: "direct" | "planned" | "fallback";
  queries: string[];
  requests: Array<{
    query: string;
    limit: number;
    maxFetches: number;
  }>;
  results: WebResultDiagnostic[];
  finalPrompt: {
    includedChunkIds: string[];
    usedTokens: number;
  };
}

export interface WebResultDiagnostic {
  chunkId: string;
  query: string;
  url: string;
  title: string;
  providerRank: number;
  processingRank?: number;
  relevanceScore: number;
  wasContentFetched: boolean;
  textSource: "fetched-content" | "search-snippet";
  textCharacters: number;
  estimatedTokens: number;
  textPreview: string;
  status: "candidate" | "included" | "dropped";
  promptOrder?: number;
  reason?: "duplicate-url" | "web-evidence-limit" | "evidence-planner";
}

export interface RetrievalChunkDiagnostic {
  id: string;
  path: string;
  rank: number;
  score: number;
  status: "included" | "dropped" | "filtered";
  reason?: string;
}

export interface ContextIndexDiagnostics {
  status: string;
  available: boolean;
  isStale?: boolean;
  indexedFiles?: number;
  errorMessage?: string;
}

export interface SkillContextDiagnostics {
  discoveredCount: number;
  warnings: Array<{ path: string; reason: string }>;
  selectedId?: string;
  selectedName?: string;
  selectedPath?: string;
  selectionMode: "automatic" | "manual" | "none";
  loadMode: "read_note" | "inline" | "none";
  loadStatus: "not-selected" | "selected" | "loaded" | "failed";
  loadedCharacters?: number;
  loadedTokens?: number;
  loadError?: string;
  truncated?: false;
  selectorWarning?: string;
}

export interface ToolCallDiagnostic {
  id: string;
  name: string;
  status: "success" | "failed" | "skipped";
  arguments: Record<string, unknown>;
  resultPreview?: string;
  resultBytes?: number;
  round: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
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

export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "specific"; name: string };

export interface ToolCallingCapabilities {
  calls: boolean;
  choiceRequired: boolean;
  choiceSpecific: boolean;
  parallelCalls: boolean;
}

export interface ReasoningCapabilities {
  enabled: boolean;
  continuation: boolean;
  summary: boolean;
}

export interface ProviderContinuationState {
  provider: ApiFormat;
  opaque: unknown;
}

export type ModelOutputItem =
  | { type: "text"; text: string }
  | { type: "reasoning"; providerData: unknown; summary?: string }
  | { type: "toolCall"; call: ChatToolCall };

export interface ModelRoundResult {
  items: ModelOutputItem[];
  continuation?: ProviderContinuationState;
  stopReason: "complete" | "tool_calls" | "length" | "error";
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
  parallelToolCalls?: boolean;
  reasoningEnabled?: boolean;
  signal?: AbortSignal;
}

export interface ChatResponseChunk {
  content: string;
  isComplete: boolean;
  toolCalls?: ChatToolCall[];
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
  size?: number;
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
  boostedSourcePaths?: string[];
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
  getAdjacentChunks(
    source: SourceReference,
    chunkId: string,
    radius: number,
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

export interface WebPageFetchOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxContentChars?: number;
  maxRedirects?: number;
}

export interface WebPageFetchSuccess {
  ok: true;
  url: string;
  finalUrl: string;
  content: string;
  contentType: string;
  bytes: number;
  truncated: boolean;
  redirects: string[];
}

export interface WebPageFetchFailure {
  ok: false;
  error: ToolError;
}

export type WebPageFetchResult = WebPageFetchSuccess | WebPageFetchFailure;

export interface SearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<SearchProviderResult[]>;
  fetchPage?(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult>;
}

export interface ResearchAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  evidence?: RetrievedChunk[];
  contextDiagnostics?: ContextDiagnostics;
  followUpQuestions: string[];
  createdAt: string;
}
