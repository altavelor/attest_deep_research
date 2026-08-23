import { RetrievedChunk } from "@core/model/source";
import { ContextDiagnostics } from "@core/diagnostics";
import { ResearchAnswer } from "@core/answer";
import { ResearchMode } from "@core/research/researchMode";

export interface ConversationCompactionSummary {
  userGoals: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  citedSourcesAlreadyUsed: string[];
}

export interface ChatDisplayMessage {
  id?: string;
  role: "user" | "assistant";
  kind?: "message" | "compact-summary";
  content: string;
  createdAt: string;

  contextPaths?: string[];
  modelName?: string;
  compacted?: boolean;
  compactSummary?: ConversationCompactionSummary;
  evidence?: RetrievedChunk[];
  answer?: ResearchAnswer;
  contextDiagnostics?: ContextDiagnostics;
  reasoning?: Array<{ id: string; content: string }>;
  reasoningOpen?: boolean;
  researchProgress?: AssistantResearchProgress;
  isFallback?: true;
  fallbackReason?: string;
}

export interface ReasoningSegment {
  id: string;
  kind: "text" | "summary";
  content: string;
}

export interface AssistantReasoningState {
  phase: "idle" | "streaming" | "complete" | "interrupted";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  segments: ReasoningSegment[];
}

export interface ResearchProgressCheckpoint {
  id: string;
  round: number;
  content: string;
  status: "streaming" | "finalizing" | "complete" | "superseded" | "interrupted";

  bodyOffset?: number;
}

export type ChainItem =
  | { kind: "reasoning"; segmentId: string; content: string }
  | {
      kind: "checkpoint";
      id: string;
      round: number;
      content: string;
      status: "streaming" | "complete" | "superseded";
    }
  | {
      kind: "tool-call";
      id: string;
      name: string;
      label: string;
      status: "pending" | "complete" | "failed";
      resultSummary?: string;
      args?: Record<string, unknown>;
      fetchTargets?: string[];
      searchSources?: string[];
      resultJson?: string;

      phase?: string;

      children?: ChainItem[];
    };

export interface AssistantResearchProgress {
  phase: "idle" | "streaming" | "complete" | "interrupted";
  mode?: ResearchMode;
  disclosure: "auto" | "user-open" | "user-closed";
  view: "expanded" | "compact";
  reasoning: AssistantReasoningState;
  checkpoints: ResearchProgressCheckpoint[];
  chain: ChainItem[];
}
