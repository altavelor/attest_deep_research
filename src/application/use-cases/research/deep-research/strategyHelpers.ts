import type { ResearchStreamEvent } from "@application/contracts/research";
import {
  ResearchBudgetOwner,
  budgetLimits,
  currentHypotheses,
  deepResearchRejected,
  type ResearchDecision,
  type ResearchState,
} from "@core/research/deepResearch";
import { scheduleTimeout } from "@shared";

/** Builds the event that points the turn message at the current research revision. */
export function referenceEvent(state: ResearchState): ResearchStreamEvent {
  return {
    type: "research",
    reference: { researchId: state.researchId, artifact: "plan", revision: state.revision },
  };
}

/** Tells whether a research is in a phase a turn executes. */
export function isExecuting(state: ResearchState): boolean {
  return (
    state.phase === "gathering" ||
    state.phase === "discovering" ||
    state.phase === "verifying" ||
    state.phase === "synthesizing"
  );
}

/** Returns the stored budget with the allocations of a dead turn consumed, keeping its active time. */
export function reopenedBudget(state: ResearchState, now: () => Date): ResearchState["budget"] {
  if (!state.budget) return null;
  const owner = new ResearchBudgetOwner(budgetLimits(state.plan!), () => now().getTime());
  owner.open(state.budget);
  return { ...owner.snapshot(), activeMs: state.budget.activeMs };
}

/** Schedules the research time limit with the platform timer. */
export function defaultTimer(delayMs: number, callback: () => void): () => void {
  return scheduleTimeout(callback, delayMs).cancel;
}

/** Builds the rejection of a decision that no longer matches the research. */
export function stale(): Error {
  return deepResearchRejected(
    "research-stale-decision",
    "This decision no longer matches the research; review the current plan.",
  );
}

/** Tells whether an error is an abort. */
export function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}

/**
 * Reads the free-text observation a pending observation decision carries for the test the pending
 * decision names. A malformed payload is rejected; a payload naming another test, or a test of a
 * superseded hypothesis revision, is stale. A skip carries no text and ends the observation stage.
 */
export function suppliedObservation(
  active: ResearchState,
  decision: ResearchDecision,
): { testId: string; text: string | null } {
  const payload = decision.payload as { action?: unknown; text?: unknown; testId?: unknown } | null;
  const skip = payload?.action === "skip-observations";
  const text = !skip && typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!skip && text === "") {
    throw deepResearchRejected("research-invalid-decision", "The decision is malformed.");
  }
  const pending = active.pending!;
  if (payload?.testId !== undefined && payload.testId !== pending.subjectId) throw stale();
  const discovery = active.discovery!;
  const current = currentHypotheses(discovery.hypotheses);
  const test = discovery.tests.find(
    (entry) =>
      entry.testId === pending.subjectId &&
      entry.status === "awaiting-input" &&
      entry.hypothesisRevision === pending.artifactRevision &&
      current.some(
        (hypothesis) =>
          hypothesis.hypothesisId === entry.hypothesisId &&
          hypothesis.revision === entry.hypothesisRevision,
      ),
  );
  if (!test) throw stale();
  return { testId: test.testId, text: skip ? null : text };
}
