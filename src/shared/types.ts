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

export interface ToolCapabilityProbeAudit {
  ranAt: string;
  modelName: string;
  apiFormat: ApiFormat;
  results: {
    required: string[];
    specific: string[];
    auto: string[];
  };
  rawCapabilities: {
    calls: boolean;
    choiceRequired: boolean;
    choiceSpecific: boolean;
    parallelCalls: boolean;
  };
}

export interface ContextDiagnostics {
  reportSchemaVersion?: 2;
  executionStrategy?: ResearchExecutionStrategy;
  /** The user's original question, trimmed. Added in v3. */
  question?: string;
  /** Chat model name. Added in v3. */
  modelName?: string;
  /** API format of the chat model. Added in v3. */
  modelApiFormat?: ApiFormat;
  /** Search mode used for this request. Added in v3. */
  searchMode?: string;
  /** Probe audit trail. Added in v3. */
  probeAudit?: ToolCapabilityProbeAudit;
  /** Effective tool calling capabilities used for policy resolution. Added in v3. */
  toolCapabilities?: ToolCallingCapabilities;
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
  tools: ToolCallDiagnostic[];
  warnings: string[];
  agentic?: AgenticAttemptDiagnostics;
  reasoning?: ReasoningDiagnostics;
  run?: RunDiagnostics;
  attempts?: AttemptDiagnostics[];
  stream?: StreamDiagnostics;
  projection?: ProjectionDiagnostics;
  delivery?: DeliveryDiagnostics;
}

export interface DiagnosticTimelineEvent {
  offsetMs: number;
  type: string;
  round?: number;
  status?: string;
  reason?: string;
}

export interface RunDiagnostics {
  runId: string;
  answerId: string;
  status: "completed" | "failed" | "cancelled" | "replaced";
  startedAt: string;
  durationMs: number;
  lastPhase: string;
  terminalReason?: string;
  timeline: DiagnosticTimelineEvent[];
  omittedTimelineEvents?: number;
  budgets?: Record<string, { used: number; limit: number }>;
}

export interface AttemptDiagnostics {
  attempt: number;
  protocol: ChatApiProtocol;
  status: "completed" | "failed" | "cancelled";
  outputEmitted: boolean;
  errorCode?: string;
  fallbackDecision?: string;
}

export interface StreamDiagnostics {
  protocol: ChatApiProtocol;
  protocolSource: "profile" | "cache" | "probe" | "fallback";
  observedDialects: string[];
  frameCount: number;
  malformedFrameCount: number;
  ignoredEventCount: number;
  reasoningDeltaCount: number;
  textDeltaCount: number;
  toolDeltaCount: number;
  synthesizedStartCount: number;
  synthesizedEndCount: number;
  aliasConflictCount: number;
  terminalEventObserved: boolean;
  doneMarkerObserved: boolean;
  warnings: string[];
  firstByteMs?: number;
  firstReasoningMs?: number;
}

export interface ProjectionDiagnostics {
  reasoningSegments: number;
  checkpointsCreated: number;
  finalAnswersCommitted: number;
  bufferedTextChars: number;
  staleEventsIgnored: number;
  duplicateDeltasIgnored: number;
  classifications: Array<{
    round: number;
    classification: "intermediate" | "final" | "discarded";
    reason: string;
  }>;
}

export interface DeliveryDiagnostics {
  projectorEventsReceived: number;
  uiPatchesApplied: number;
  coalescedUpdates: number;
  markdownRenders: number;
  staleRunEventsIgnored: number;
  persistenceStatus: "not-requested" | "saved" | "failed";
  reloadRestored?: boolean;
}

export interface ReasoningDiagnostics {
  protocol: ChatApiProtocol;
  capabilitySource?: "metadata" | "probe" | "manual" | "observed";
  observedFormats?: string[];
  configuredEffort?: string;
  summaryRequested: boolean;
  summaryAvailable: boolean;
  reasoningItemCount: number;
  continuationRounds: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/**
 * Attribution of a single reasoning segment to the agentic round and phase that
 * produced it. Lets the diagnostic report map each "thinking" block back to its
 * round/phase instead of guessing from the timeline.
 */
export interface ReasoningSegmentAttribution {
  segmentId: string;
  round: number;
  phase: string;
  chars: number;
}

export interface AgenticAttemptDiagnostics {
  policyReason: string;
  requiredTools: string[];
  bootstrapChoice?: ChatToolChoice;
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
  reasoningSegments?: ReasoningSegmentAttribution[];
  stopReasons?: string[];
  budgets?: {
    maxRounds: number;
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
  dropReason?: "budget-overflow" | "score-threshold" | "policy" | "explicit-limit";
}

export interface ContextIndexDiagnostics {
  status: string;
  available: boolean;
  isStale?: boolean;
  indexedFiles?: number;
  errorMessage?: string;
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
  readonly provider: ApiFormat;
  dispose(): void;
}

export type ModelOutputItem =
  | { type: "text"; text: string }
  | { type: "reasoningSummary"; text: string }
  | { type: "toolCall"; call: ChatToolCall };

export interface ModelRoundResult {
  items: ModelOutputItem[];
  continuation?: ProviderContinuationState;
  stopReason: "complete" | "tool_calls" | "length" | "error";
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
  reasoningItemCount?: number;
}

export interface ModelToolOutput {
  callId: string;
  output: string;
}

export type ModelStreamEvent =
  | { type: "reasoning-start"; segmentId: string; visibility: "text" | "summary" }
  | { type: "reasoning-delta"; segmentId: string; text: string }
  | { type: "reasoning-end"; segmentId: string }
  | { type: "text-delta"; text: string }
  | {
    type: "tool-call-delta";
    index: number;
    id?: string;
    name?: string;
    argumentsText?: string;
  }
  | {
    type: "usage";
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  }
  | { type: "complete"; stopReason: "complete" | "tool_calls" | "length" | "error" };

export type ModelRoundDelta =
  | { type: "text"; text: string }
  | { type: "reasoningSummary"; text: string; segmentId?: string };

export interface ModelRoundRequest extends ChatRequest {
  continuation?: ProviderContinuationState;
  toolOutputs?: ModelToolOutput[];
  reasoning?: {
    enabled: boolean;
    effort?: string;
    summary: "off" | "auto";
  };
  onEvent?(event: ModelStreamEvent): void;
  onDelta?(delta: ModelRoundDelta): void;
}

export interface ModelRoundProvider {
  listModels(): Promise<string[]>;
  runRound(request: ModelRoundRequest): Promise<ModelRoundResult>;
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
  /**
   * Optional reasoning depth hint for providers that support it (Anthropic
   * `effort`, Ollama think levels). Undefined leaves the provider on its
   * adaptive default.
   */
  reasoningEffort?: string;
  signal?: AbortSignal;
}

export interface ChatResponseChunk {
  content: string;
  isComplete: boolean;
  toolCalls?: ChatToolCall[];
  events?: ModelStreamEvent[];
}

export type ApiFormat = "openai-compatible" | "ollama" | "anthropic";
export type ChatApiProtocol = "chat-completions" | "responses";
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
  isFallback?: true;
  fallbackReason?: string;
}
