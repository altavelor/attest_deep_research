import { ApiFormat } from "@core/agent";
import { ChatToolChoice } from "@core/agent";
import {
  ContextDiagnostics,
  RoundPromptDeltaDiagnostic,
  ToolCallDiagnostic,
  WebSourceSelectionDiagnostics,
} from "@core/diagnostics";

export interface DiagnosticReportV3 {
  schemaVersion: 3;
  question: string;
  findings: FindingsSection;
  model: ModelSection;
  preflight: PreflightSection;
  request: RequestSection;
  reasoning: ReasoningSection;
  answer: AnswerSection;
  stats: StatsSection;
}

export interface FindingsSection {
  summary: string;
  findings: Finding[];
}

export interface Finding {
  severity: "error" | "warning" | "info";
  code: string;
  title: string;
  detail: string;
  affectedSection: "model" | "preflight" | "request" | "reasoning" | "answer";
  evidence: Record<string, unknown>;
}

export interface ModelSection {
  name: string;
  apiFormat: ApiFormat | null;
  executionStrategy: string;
  toolCapabilities: {
    calls: boolean;
    choiceRequired: boolean;
    choiceSpecific: boolean;
    parallelCalls: boolean;
    provenance: Record<string, string>;
    probe: {
      ranAt: string;
      modelName: string;
      apiFormat: ApiFormat;
      results: { required: string[]; specific: string[]; auto: string[] };
      rawCapabilities: {
        calls: boolean;
        choiceRequired: boolean;
        choiceSpecific: boolean;
        parallelCalls: boolean;
      };
    } | null;
  };
  reasoning: {
    protocol: string;
    capabilitySource: string | null;
    configuredEffort: string | null;
    summaryRequested: boolean;
    summaryAvailable: boolean;
  } | null;
}

export interface PreflightSection {
  index: {
    status: string;
    available: boolean;
    isStale: boolean;
    indexedFiles: number;
    errorMessage?: string;
  } | null;
  indexDescription: {
    freshness: string;
    textHash: string;
    algorithmVersion: number;
    generatedAt: string;
    indexUpdatedAt: string;
    representativeChunkCount: number;
    truncated: boolean;
    usedFallback: boolean;
    failureReason?: string;
  } | null;
  context: {
    mode: string;
    sources: ContextDiagnostics["explicitSources"];
    graph: ContextDiagnostics["graph"];
    budget: {
      limitTokens: number | null;
      reservedOutputTokens: number | null;
      usedTokens: number;
      utilizationPct: number | null;
      groups: ContextDiagnostics["budget"]["groups"];
    };
  };
  warnings: string[];
}

export interface RequestSection {
  searchMode: string;
  thinkingPolicy: {
    policyReason: string;
    requiredTools: string[];
    bootstrapChoice: ChatToolChoice | null;
  };
  retrieval: {
    queryVariants: string[];
    filteredSourcePaths: string[];
    rankedChunks: Array<{
      id: string;
      path: string;
      rank: number;
      score: number;
      status: "included" | "dropped" | "filtered";
      reason?: string;
      dropReason?: string;
    }>;
    includedChunkIds: string[];
    droppedChunkIds: string[];
    scoreStats: { min: number; max: number; avg: number; threshold: number | null } | null;
  } | null;
  web: ContextDiagnostics["web"] | null;
  webSourceSelection: WebSourceSelectionDiagnostics | null;

  webSourceSelections: WebSourceSelectionDiagnostics[] | null;

  omittedWebSourceSelections: number;
  evidencePlanner: ContextDiagnostics["evidencePlanner"] | null;
}

export interface ThinkingLoopRound {
  round: number;
  phase: string;

  promptDelta: RoundPromptDeltaDiagnostic | null;
  toolCalls: ToolCallDiagnostic[];
  reasoningSegments: Array<{ segmentId: string; chars: number }>;
  hadTextOutput: boolean;
  classification: "intermediate" | "final" | "discarded" | null;
}

export interface ReasoningSection {
  attempts: Array<{
    attempt: number;
    protocol: string;
    status: string;
    outputEmitted: boolean;
    errorCode?: string;
    fallbackDecision?: string;
  }>;
  stream: ContextDiagnostics["stream"] | null;
  thinkingLoop: {
    totalRounds: number;
    totalCalls: number;
    duplicateCalls: number;
    satisfiedTools: string[];
    repairedTools: string[];
    fallbackReason?: string;
    stopReasons: string[];
    budgets: {
      maxRounds: number;
      maxResultChars: number;
      usedResultChars: number;
    } | null;
    rounds: ThinkingLoopRound[];
  } | null;
  tokens: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  reasoningItemCount: number;
  continuationRounds: number;
}

export interface AnswerSection {
  projection: ContextDiagnostics["projection"] | null;
  delivery: ContextDiagnostics["delivery"] | null;
  unknownCitationIds: string[];
  unverifiedCitations: string[];
}

export interface StatsSection {
  runId: string;
  answerId: string;
  status: string;
  startedAt: string;
  durationMs: number;
  lastPhase: string;
  terminalReason?: string;
  timeline: ContextDiagnostics["run"] extends undefined
    ? never
    : NonNullable<ContextDiagnostics["run"]>["timeline"];
  omittedTimelineEvents?: number;
}
