import { ApiFormat, ChatApiProtocol } from "./agent/protocol";
import { ChatToolChoice, ToolCallingCapabilities } from "./agent/tool";

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

  question?: string;

  modelName?: string;

  modelApiFormat?: ApiFormat;

  searchMode?: string;

  probeAudit?: ToolCapabilityProbeAudit;

  toolCapabilities?: ToolCallingCapabilities;

  capabilityProvenance?: Record<string, string>;
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
  thinking?: ThinkingAttemptDiagnostics;
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

export interface ReasoningSegmentAttribution {
  segmentId: string;
  round: number;
  phase: string;
  chars: number;
}

export interface PromptDeltaMessageDiagnostic {
  role: string;
  chars: number;

  content?: string;

  truncatedChars?: number;
  toolCallId?: string;

  toolCallNames?: string[];
}

export interface RoundPromptDeltaDiagnostic {
  round: number;

  toolChoice: string;

  viaContinuation?: boolean;
  messages: PromptDeltaMessageDiagnostic[];
}

export interface ThinkingAttemptDiagnostics {
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

  unverifiedCitations?: string[];
  phases?: string[];
  promptDeltas?: RoundPromptDeltaDiagnostic[];
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
  | "instant"
  | "instant-fallback"
  | "thinking"
  | "deep-research";

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
