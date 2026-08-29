import type { ToolEvent } from "@core/agent";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";

import type { ResearchToolsetOptions } from "./toolPorts";

export interface SubAgentRunInput {
  task: string;

  toolContext?: ResearchToolsetOptions;

  budget?: { maxRounds?: number; maxResultChars?: number; maxSearches?: number };

  resources?: readonly string[];
  signal?: AbortSignal;

  onEvent?: (event: ToolEvent) => void;
}

export interface SubAgentRunResult {
  answerText: string;

  snapshot: ResearchEvidenceSnapshot;
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
