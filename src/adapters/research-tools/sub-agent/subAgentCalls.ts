import { toolFailure, type ToolExecution } from "@core/agent";
import { SubAgentSessionFailure } from "@core/research";

const UNSAFE_ID_CHARACTERS = /[^A-Za-z0-9_-]/gu;
const MAX_CALL_PART_CHARS = 80;

/**
 * Derives the host-side identity of one model tool call from the parent run, the model
 * round and the provider call ID; the call ID alone repeats across rounds for providers
 * whose calls are parsed from text. A call ID changed by sanitizing or cutting gets a
 * hash of the original, so two distinct calls never share one identity.
 */
export function subAgentCallIdentity(
  parentRunId: string,
  round: number | undefined,
  callId: string,
): string {
  const safe = callId.replace(UNSAFE_ID_CHARACTERS, "_").slice(0, MAX_CALL_PART_CHARS);
  const call = safe === callId && safe ? safe : `${safe || "call"}-${fnv1a32(callId)}`;
  return `${parentRunId.replace(UNSAFE_ID_CHARACTERS, "_")}-r${round ?? 0}-${call}`;
}

/** Turns a rejected delegator call into a model-visible failure with a safe code and text. */
export function subAgentToolFailure(error: unknown): ToolExecution<never> {
  if (error instanceof SubAgentSessionFailure) {
    return toolFailure(error.code, error.message);
  }
  return toolFailure("sub-agent-failed", "Sub-agent session failed.", true);
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
