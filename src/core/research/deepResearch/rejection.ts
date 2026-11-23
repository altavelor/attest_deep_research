import { AttestError } from "@core/errors";

export type DeepResearchRejectionReason =
  | "research-stale-decision"
  | "research-invalid-decision"
  | "research-generation-limit"
  | "research-invalid-plan"
  | "research-state-unreadable"
  | "research-revision-conflict"
  | "research-section-too-large"
  | "research-active"
  | "research-preflight"
  | "research-generation-failed"
  | "research-continue-unavailable"
  | "research-input-too-long"
  | "research-export-folder"
  | "research-export-name";

const MAX_REASON_CHARS = 500;

/** Bounds untrusted failure text, such as a provider error, before it enters a message or state. */
export function boundedReason(text: string): string {
  return text.length <= MAX_REASON_CHARS ? text : `${text.slice(0, MAX_REASON_CHARS - 1)}…`;
}

/** Builds the readable failure of a Deep Research turn; the reason names the violated rule. */
export function deepResearchRejected(
  reason: DeepResearchRejectionReason,
  message: string,
): AttestError {
  return new AttestError({
    code: "DEEP_RESEARCH_REJECTED",
    message: boundedReason(message),
    details: { reason },
  });
}
