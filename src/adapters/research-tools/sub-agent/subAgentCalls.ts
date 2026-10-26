import { toolFailure, type ToolExecution } from "@core/agent";
import { SubAgentSessionFailure } from "@core/research";

const UNSAFE_ID_CHARACTERS = /[^A-Za-z0-9_-]/gu;
const MAX_CALL_PART_CHARS = 80;

/**
 * Derives the host-side identity of one model tool call from the parent run, the model
 * round and the provider call ID; the call ID alone repeats across rounds for providers
 * whose calls are parsed from text.
 */
export function subAgentCallIdentity(
  parentRunId: string,
  round: number | undefined,
  callId: string,
): string {
  const call = callId.replace(UNSAFE_ID_CHARACTERS, "_").slice(0, MAX_CALL_PART_CHARS) || "call";
  return `${parentRunId.replace(UNSAFE_ID_CHARACTERS, "_")}-r${round ?? 0}-${call}`;
}

/** Turns a rejected delegator call into a model-visible failure with a safe code and text. */
export function subAgentToolFailure(error: unknown): ToolExecution<never> {
  if (error instanceof SubAgentSessionFailure) {
    return toolFailure(error.code, error.message);
  }
  return toolFailure("sub-agent-failed", "Sub-agent session failed.", true);
}
