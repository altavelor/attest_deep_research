import type { ResearchStreamEvent } from "@application/contracts/research";
import {
  ResearchBudgetOwner,
  deepResearchRejected,
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
  return state.phase === "gathering" || state.phase === "synthesizing";
}

/** Returns the stored budget with the allocations of a dead turn consumed, keeping its active time. */
export function reopenedBudget(state: ResearchState, now: () => Date): ResearchState["budget"] {
  if (!state.budget) return null;
  const owner = new ResearchBudgetOwner(state.plan!.limits, () => now().getTime());
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
