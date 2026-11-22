import type { ToolEvent } from "@core/agent";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import type { ThinkingFallbackReason } from "@application/use-cases/research/ThinkingResearchRunner";

import type { ResearchToolsetOptions } from "./toolPorts";

export interface SubAgentRunInput {
  task: string;

  toolContext?: ResearchToolsetOptions;

  budget?: { maxRounds?: number; maxResultChars?: number; maxSearches?: number };

  resources?: readonly string[];
  signal?: AbortSignal;

  onEvent?: (event: ToolEvent) => void;

  onToolCall?: (call: SubAgentToolCall) => void;

  onToolResult?: (result: SubAgentToolResult) => void;
}

export interface SubAgentToolCall {
  id: string;
  name: string;
  label: string;
  round: number;
  args?: Record<string, unknown>;
}

export interface SubAgentToolResult {
  id: string;
  ok: boolean;
  resolvedLabel?: string;
  resultSummary?: string;
  resultJson?: string;
}

export type SubAgentFailureReason = ThinkingFallbackReason | "tool-exception";

export interface SubAgentTelemetry {
  runId: string;
  durationMs: number;
  loopDurationMs: number;
  rounds: number;
  maxRounds: number;
  hitRoundLimit: boolean;
  failureReason?: SubAgentFailureReason;
  toolCalls: number;
  duplicateToolCalls: number;
  searchCalls: number;
  maxSearches: number;
  searchBudgetRejections: number;
  usedSynthesisFallback: boolean;
  answerChars: number;
  usage: SubAgentUsage;
}

export interface SubAgentRunResult {
  answerText: string;

  snapshot: ResearchEvidenceSnapshot;

  telemetry?: SubAgentTelemetry;
}

export interface SubAgentPort {
  run(input: SubAgentRunInput): Promise<SubAgentRunResult>;
}

export const SUB_AGENT_PHASE = "sub-agent-phase";
export const SUB_AGENT_TOOL_START = "sub-agent-tool-start";
export const SUB_AGENT_TOOL_END = "sub-agent-tool-end";

export interface SubAgentUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export type SubAgentLogEvent =
  | {
      type: "session-start";
      task: string;
      model: string;
      maxRounds: number;
      maxResultChars: number;
      maxSearches?: number;
      reasoning?: { enabled: boolean; effort?: string };
    }
  | { type: "tool-call"; round: number; name: string; label: string }
  | { type: "tool-result"; name: string; ok: boolean; summary?: string }
  | {
      type: "loop-complete";
      ok: boolean;
      reason?: string;
      rounds: number;
      totalCalls: number;
      duplicateCalls: number;
      totalResultChars: number;
      stopReasons: string[];
      answerChars: number;
      usage: SubAgentUsage;
      durationMs: number;
    }
  | { type: "synthesis-start"; sourceCount: number; excerptChars: number }
  | { type: "synthesis-complete"; outputChars: number; error?: string }
  | {
      type: "session-complete";
      sourceCount: number;
      usedSynthesisFallback: boolean;
      durationMs: number;
    };

export interface SubAgentLogger {
  logSubAgent(event: SubAgentLogEvent): void;
}
