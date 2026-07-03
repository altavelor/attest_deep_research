// Port for launching an in-process universal sub-agent. The `run_subagent` tool
// depends on this neutral abstraction; the concrete agent (SubAgentRunner) lives
// in application/use-cases and is injected by the composition root via the
// research toolset options.

import type { ToolEvent } from "@core/agent";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
// Type-only: ResearchToolsetOptions lives in ./toolPorts, which imports SubAgentPort
// from this file. The cycle is erased at compile time (import type), so it is
// runtime-safe (see AGENTS.md §2).
import type { ResearchToolsetOptions } from "./toolPorts";

export interface SubAgentRunInput {
  /** Free-form instruction the orchestrating model delegates to the sub-agent. */
  task: string;
  /** Tool availability + collaborators for the current turn (index/web/notes, no mutation, no recursion). */
  toolContext?: ResearchToolsetOptions;
  /** Per-run budget override, tighter than the runner's default (used by fan-out map_sources). */
  budget?: { maxRounds?: number; maxResultChars?: number };
  signal?: AbortSignal;
  /** Progress sink so a session's internal work can be surfaced live (nested). */
  onEvent?: (event: ToolEvent) => void;
}

export interface SubAgentRunResult {
  /** The sub-agent's final free-text answer, already citing evidence in the shared format. */
  answerText: string;
  /** Evidence the sub-agent gathered, for merging into the parent evidence registry. */
  snapshot: ResearchEvidenceSnapshot;
}

export interface SubAgentPort {
  run(input: SubAgentRunInput): Promise<SubAgentRunResult>;
}

// Progress event payloads the sub-agent emits through `onEvent`. The research
// strategy maps these into nested ResearchStreamEvents (tagged with the parent
// run_subagent call id).
export const SUB_AGENT_PHASE = "sub-agent-phase";
export const SUB_AGENT_TOOL_START = "sub-agent-tool-start";
export const SUB_AGENT_TOOL_END = "sub-agent-tool-end";

// --- Diagnostic logging -----------------------------------------------------
// A neutral sink the sub-agent writes a detailed trace to so a stuck or empty
// session can be diagnosed offline. The concrete logger (gated by debug mode)
// is injected from the composition root; when absent the agent stays silent.

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
      reasoning?: { enabled: boolean; effort?: string };
    }
  | { type: "tool-call"; round: number; name: string; label: string }
  | { type: "tool-result"; name: string; ok: boolean; summary?: string }
  | {
      // The sub-agent's bounded tool loop finished (before any synthesis fallback).
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
