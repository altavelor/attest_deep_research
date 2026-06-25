// Backward-compatibility barrel (stage 1). The real definitions now live in
// their owning domains: core/model, core/agent, application/ports, research/*.
// Importers should migrate to the owning modules; this barrel will be removed
// once they have (task F.1).

export type {
  SourceKind,
  DocumentFormat,
  SourceReferenceBase,
  MarkdownSourceReference,
  PdfSourceReference,
  DocumentSourceReference,
  WebSourceReference,
  SourceReference,
  ExtractedChunk,
  EmbeddedChunk,
  RetrievedChunk,
} from "../core/model/source";
export type { Citation, LanguageCode, LanguageInventoryItem } from "../core/model/citation";

export type {
  ChatToolDefinition,
  ChatToolCall,
  ChatToolChoice,
  ToolCallingCapabilities,
  ToolError,
} from "../core/agent/tool";
export type {
  ReasoningCapabilities,
  ProviderContinuationState,
  ModelOutputItem,
  ModelRoundResult,
  ModelToolOutput,
  ModelStreamEvent,
  ModelRoundDelta,
  ModelRoundRequest,
  ModelRoundProvider,
  ChatMessage,
  ChatRequest,
  ChatResponseChunk,
  ApiFormat,
  ChatApiProtocol,
  LocalModelProvider,
  ChatModelProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingProviderClient,
} from "../core/agent/protocol";

export type {
  ExtractorInput,
  Extractor,
  IndexStoreMetadata,
  IndexStore,
  IndexStoreWriteSession,
  IndexSourceSnapshot,
  IndexFailedSourceSnapshot,
  SourceSnapshotIndexStore,
  LanguageInventoryIndexStore,
} from "../application/ports/indexing";
export type {
  RetrievalOptions,
  RetrievalQueryVariant,
  KeywordSearchIndexStore,
  AdjacentChunkIndexStore,
  Retriever,
} from "../application/ports/retrieval";
export type {
  SearchProviderResult,
  WebSearchOptions,
  WebPageFetchOptions,
  WebPageFetchSuccess,
  WebPageFetchFailure,
  WebPageFetchResult,
  SearchProvider,
} from "../application/ports/web";

export type {
  ContextMode,
  ContextSourceRole,
  ContextDiagnosticSource,
  ContextBudgetGroup,
  EvidencePlannerDiagnostics,
  GraphEdgeType,
  ContextGraphEdgeDiagnostic,
  ContextGraphCandidateDiagnostic,
  ContextGraphDiagnostics,
  ToolCapabilityProbeAudit,
  ContextDiagnostics,
  DiagnosticTimelineEvent,
  RunDiagnostics,
  AttemptDiagnostics,
  StreamDiagnostics,
  ProjectionDiagnostics,
  DeliveryDiagnostics,
  ReasoningDiagnostics,
  ReasoningSegmentAttribution,
  AgenticAttemptDiagnostics,
  IndexDescriptionPromptDiagnostics,
  IndexDescriptionPromptContext,
  ResearchExecutionStrategy,
  WebContextDiagnostics,
  WebResultDiagnostic,
  RetrievalChunkDiagnostic,
  ContextIndexDiagnostics,
  ToolCallDiagnostic,
} from "../core/diagnostics";
export type { ResearchAnswer } from "../core/answer";
