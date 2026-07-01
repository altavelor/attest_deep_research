// Core conversation model (stage 1, task 2.1). Platform-neutral domain model of
// a chat transcript; previously lived in ui/rendering.ts. Consumed by research,
// chat and ui — none of which should own it.

import { RetrievedChunk } from "@core/model/source";
import { ContextDiagnostics } from "@core/diagnostics";
import { ResearchAnswer } from "@core/answer";

export interface ConversationCompactionSummary {
  userGoals: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  citedSourcesAlreadyUsed: string[];
}

export interface ChatDisplayMessage {
  role: "user" | "assistant";
  kind?: "message" | "compact-summary";
  content: string;
  createdAt: string;
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
  status: "streaming" | "complete" | "superseded" | "interrupted";
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
      resultJson?: string;
      /** Live phase of a nested sub-agent run (e.g. deep_search). */
      phase?: string;
      /** Nested tool calls produced inside this call (e.g. a deep_search session). */
      children?: ChainItem[];
    };

export interface AssistantResearchProgress {
  phase: "idle" | "streaming" | "complete" | "interrupted";
  disclosure: "auto" | "user-open" | "user-closed";
  view: "expanded" | "compact";
  reasoning: AssistantReasoningState;
  checkpoints: ResearchProgressCheckpoint[];
  chain: ChainItem[];
}
