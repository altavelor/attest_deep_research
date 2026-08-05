import { ResearchMode } from "./researchMode";

export interface ResearchModeRetrievalParameters {
  maxQueryVariants: number;
  evidenceLimit: number;
}

const DEFAULT_PARAMETERS: ResearchModeRetrievalParameters = {
  maxQueryVariants: 8,
  evidenceLimit: 8,
};

const INSTANT_PARAMETERS: ResearchModeRetrievalParameters = {
  maxQueryVariants: 3,
  evidenceLimit: 6,
};

/**
 * Retrieval breadth per research mode. Instant trades recall for latency: fewer
 * query variants mean fewer embedding round-trips, and a smaller evidence limit
 * means a smaller prefill and a faster first token.
 */
export function researchModeRetrievalParameters(
  mode: ResearchMode,
): ResearchModeRetrievalParameters {
  return mode === "instant" ? { ...INSTANT_PARAMETERS } : { ...DEFAULT_PARAMETERS };
}
