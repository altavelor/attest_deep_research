import type { ResearchPhase, ResearchState } from "@core/research/deepResearch";

export interface ResearchResumeEntry {
  phase: ResearchPhase;
  verifying: boolean;
}

/** Chooses the phase a resumed research turn commits first from the phase of its last barrier. */
export function researchResumeEntry(start: ResearchState): ResearchResumeEntry {
  const verifying = start.phase === "verifying";
  const discovering = start.phase === "discovering" || start.phase === "awaiting-observation";
  return {
    phase: verifying ? "verifying" : discovering ? "discovering" : "gathering",
    verifying,
  };
}
