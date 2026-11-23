import { applyParams, type MessageParams } from "@core/i18n";

export const ENGLISH_RESEARCH_LABELS = {
  findingsTitle: "Research findings",
  verifiedIntro: "Verified claims are listed without a synthesized summary.",
  unverifiedIntro:
    "Unverified findings are listed per branch without a synthesized summary; their claims were not checked against the sources.",
  supportedClaims: "Supported claims",
  sources: "Sources: {tokens}",
  missingBranches: "Missing branches",
  conflictingEvidence: "Conflicting evidence",
  conflictLine: "{claim} — cited {cited}; contradicted by {contradicting}",
  weakClaims: "Unsupported or unresolved claims",
  verdictUnsupported: "unsupported",
  verdictUnresolved: "unresolved",
  unverifiedFindings: "Unverified findings",
  uncoveredObjectives: "Uncovered objectives",
  stopReasonLine: "Stop reason: {reason}",
  stopSettled: "All scheduled branches settled.",
  stopTime: "The active execution time limit was reached.",
  stopUser: "Stopped by the user.",
  stopBudget: "The research budget is exhausted ({dimension}).",
  noBranchCompleted: "No branch completed. {reason}",
  hypotheses: "Hypotheses",
  hypothesisLine: "({label}) {claim} (revision {revision}).",
  alternative: "Alternative: {text}.",
  knownOmissions: "Known omissions:",
  statusUntested: "untested",
  statusSupported: "supported",
  statusDisconfirmed: "disconfirmed",
  statusInconclusive: "inconclusive",
  supportedByLiterature: "supported by literature",
  skippedObservation: "{status} — the user skipped the observation",
  byUserObservation: "{status} by a user observation — {limitations}",
  observationLimitation: "reported, not independently checked",
  partialReport: "Partial report: required branches are missing ({branches}).",
  removedCitations: "{count} citation(s) without a source in the findings were removed.",
  unverifiedCitations: "{count} citation(s) could not be verified against the cited source text.",
  turnCancelled: "Research cancelled.",
  turnPlanUpdated: "Plan updated to revision {revision}.",
  turnPlanRegenerated: "Plan regenerated (generation {used} of {max}).",
  turnPlanStale: "The approved plan is old; continue anyway, replan or cancel the research.",
  turnObservationStale:
    "Observation recorded. The approved plan is old; continue anyway, replan or cancel the research.",
  turnNewPlan: "A new plan is ready for review.",
  turnNeedsObservation: "The research needs an observation you supply: {method}",
  turnFailed: "Research failed: {reason}",
  turnNeedsClarification: "The research needs clarification: {count} question(s).",
  turnPlanReady: "Research plan ready for review: {count} branches.",
  cancelledByUser: "Cancelled by the user.",
  interruptedPlanning: "Interrupted during planning.",
  stoppedDrafting: "Stopped while drafting the plan.",
  planFailed: "The plan could not be generated.",
} as const;

export type ResearchLabelKey = keyof typeof ENGLISH_RESEARCH_LABELS;

export type ResearchLabels = Readonly<Record<ResearchLabelKey, string>>;

export const RESEARCH_LABEL_KEYS = Object.keys(ENGLISH_RESEARCH_LABELS) as ResearchLabelKey[];

/** Fills the template of one answer label with its parameters. */
export function label(
  labels: ResearchLabels,
  key: ResearchLabelKey,
  params?: MessageParams,
): string {
  return applyParams(labels[key], params);
}
