import type { ResearchPhase, ResearchState } from "@core/research/deepResearch";

export interface ResearchResumeEntry {
  phase: ResearchPhase;
  synthesizing: boolean;
}

/** Chooses the phase a resumed research turn commits first from the phase of its last barrier. */
export function researchResumeEntry(start: ResearchState): ResearchResumeEntry {
  const discovering = start.phase === "discovering" || start.phase === "awaiting-observation";
  if (start.phase === "synthesizing" || start.phase === "verifying") {
    return { phase: "synthesizing", synthesizing: true };
  }
  return { phase: discovering ? "discovering" : "gathering", synthesizing: false };
}
