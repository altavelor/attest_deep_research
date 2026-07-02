// Diagnostics contracts (stage 1, tasks 1.4 + 2.1).
// Domain result DTOs produced by research orchestration and consumed by the
// conversation model (core) and the UI diagnostic report. They depend only on
// core/agent, so they live in core to keep the conversation model platform-neutral.

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

/**
 * One message appended to the model prompt since the previous round's request.
 * Tool results carry only `toolCallId` + `chars` — their content is already
 * captured (and redacted where needed) in the round's ToolCallDiagnostic.
 */
export interface PromptDeltaMessageDiagnostic {
  role: string;
  chars: number;
  /** Full text for system/user/assistant messages, capped; absent for tool results. */
  content?: string;
  /** Characters cut from `content` by the per-message cap. */
  truncatedChars?: number;
  toolCallId?: string;
  /** Names of tool calls the assistant emitted in this message. */
  toolCallNames?: string[];
}

/**
 * Incremental prompt log for one agentic round: only what was added to the
 * request since the previous round (round 1 carries the full initial prompt),
 * so the report explains model behaviour without duplicating the whole context
 * every round.
 */
export interface RoundPromptDeltaDiagnostic {
  round: number;
  /** Serialized toolChoice sent with this round's request. */
  toolChoice: string;
  /** True when the round rode provider-side continuation state (tool outputs, not messages). */
  viaContinuation?: boolean;
  messages: PromptDeltaMessageDiagnostic[];
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
