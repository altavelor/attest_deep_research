// Port for launching an in-process deep-research sub-agent. The `deep_search`
// tool depends on this neutral abstraction; the concrete agent
// (DeepResearchAgent) lives in application/use-cases and is injected by the
// composition root via the research toolset options.

import type { ToolEvent } from "@core/agent";
import type { DeepResearchReport } from "@core/research";
import type { ResearchEvidenceSnapshot } from "../sources/evidence";

export interface DeepResearchRunInput {
  question: string;
  /** Optional sub-focus the orchestrating model asked this session to cover. */
  scope?: string;
  signal?: AbortSignal;
  /** Progress sink so a session's internal work can be surfaced live (nested). */
  onEvent?: (event: ToolEvent) => void;
}

export interface DeepResearchRunResult {
  report: DeepResearchReport;
  /** Evidence the sub-agent gathered, for re-registration into the parent run. */
  snapshot: ResearchEvidenceSnapshot;
}

export interface DeepResearchRunner {
  run(input: DeepResearchRunInput): Promise<DeepResearchRunResult>;
}

// Progress event payloads the sub-agent emits through `onEvent`. The research
// strategy maps these into nested ResearchStreamEvents (tagged with the parent
// deep_search call id).
export const DEEP_RESEARCH_PHASE = "deep-research-phase";
export const DEEP_RESEARCH_TOOL_START = "deep-research-tool-start";
export const DEEP_RESEARCH_TOOL_END = "deep-research-tool-end";

// --- Diagnostic logging -----------------------------------------------------
// A neutral sink the sub-agent writes a detailed trace to so a stuck or empty
// session can be diagnosed offline. The concrete logger (gated by debug mode)
// is injected from the composition root; when absent the agent stays silent.

export interface DeepResearchUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export type DeepResearchLogEvent =
  | {
      type: "session-start";
      question: string;
      scope?: string;
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
      usage: DeepResearchUsage;
      durationMs: number;
    }
  | { type: "synthesis-start"; sourceCount: number; excerptChars: number }
  | { type: "synthesis-complete"; outputChars: number; error?: string }
  | {
      type: "session-complete";
      findingCount: number;
      sourceCount: number;
      usedSynthesisFallback: boolean;
      durationMs: number;
    };

export interface DeepResearchLogger {
  logDeepResearch(event: DeepResearchLogEvent): void;
}
