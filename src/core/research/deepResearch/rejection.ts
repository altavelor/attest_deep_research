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
  | "research-continue-unavailable";

/** Builds the readable failure of a Deep Research turn; the reason names the violated rule. */
export function deepResearchRejected(
  reason: DeepResearchRejectionReason,
  message: string,
): AttestError {
  return new AttestError({ code: "DEEP_RESEARCH_REJECTED", message, details: { reason } });
}
