import type { ResearchDiscovery, ResearchState } from "@core/research/deepResearch";
import type { ResearchDiscoveryService } from "./ResearchDiscoveryService";
import { withObservation, withObservationsSkipped } from "./researchDiscoveryPhase";

export interface SuppliedObservation {
  testId: string;
  text: string | null;
}

/**
 * Assesses a supplied observation; when the time limit interrupts the judgement, it is kept as
 * inconclusive. An observation without text skips the observation stage of the research.
 */
export async function suppliedObservation(
  start: ResearchState,
  supplied: SuppliedObservation,
  service: ResearchDiscoveryService,
  stopped: () => boolean,
): Promise<ResearchDiscovery> {
  const discovery = start.discovery!;
  if (supplied.text === null) {
    return withObservationsSkipped(discovery, discovery.cycles.at(-1)!.ordinal);
  }
  const test = discovery.tests.find((entry) => entry.testId === supplied.testId)!;
  const hypothesis = discovery.hypotheses.find(
    (entry) =>
      entry.hypothesisId === test.hypothesisId && entry.revision === test.hypothesisRevision,
  )!;
  try {
    return withObservation(discovery, await service.assessReport(hypothesis, test, supplied.text));
  } catch (error) {
    if (stopped() || !isAbort(error)) throw error;
    return withObservation(discovery, service.unjudgedReport(test, supplied.text));
  }
}

/** Tells whether an error is an abort. */
export function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}
