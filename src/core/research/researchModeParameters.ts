import { ResearchMode } from "./researchMode";

export interface ResearchModeRetrievalParameters {
  maxQueryVariants: number;
  evidenceLimit: number;
  web: ResearchModeWebParameters;
}

export interface ResearchModeWebParameters {
  deadlineMs: number;

  perSourceLimit: number;

  mergedLimit: number;

  maxConcurrentSources: number;
}

const DEFAULT_PARAMETERS: ResearchModeRetrievalParameters = {
  maxQueryVariants: 8,
  evidenceLimit: 8,
  web: { deadlineMs: 20_000, perSourceLimit: 6, mergedLimit: 20, maxConcurrentSources: 6 },
};

const INSTANT_PARAMETERS: ResearchModeRetrievalParameters = {
  maxQueryVariants: 3,
  evidenceLimit: 6,
  web: { deadlineMs: 6_000, perSourceLimit: 5, mergedLimit: 12, maxConcurrentSources: 4 },
};

/**
 * Retrieval breadth per research mode. Instant trades recall for latency: fewer
 * query variants mean fewer embedding round-trips, a smaller evidence limit means
 * a faster first token, and a tighter web deadline caps the slowest source.
 */
export function researchModeRetrievalParameters(
  mode: ResearchMode,
): ResearchModeRetrievalParameters {
  const parameters = mode === "instant" ? INSTANT_PARAMETERS : DEFAULT_PARAMETERS;
  return { ...parameters, web: { ...parameters.web } };
}
