import type { ResearchPhase } from "@core/research/deepResearch";
import { researchResumeEntry } from "@application/use-cases/research/deep-research/researchResume";
import { gatheringResearch, researchBranch, researchPlan } from "../support/deepResearch";

describe("deep research resume entry", () => {
  it("resumes a stored verification straight into the report and the other phases at their stage", () => {
    const base = gatheringResearch(researchPlan([researchBranch(1)], "balanced"));
    const entry = (phase: ResearchPhase) => researchResumeEntry({ ...base, phase });

    expect([
      entry("verifying"),
      entry("synthesizing"),
      entry("awaiting-observation"),
      entry("gathering"),
    ]).toEqual([
      { phase: "synthesizing", synthesizing: true },
      { phase: "synthesizing", synthesizing: true },
      { phase: "discovering", synthesizing: false },
      { phase: "gathering", synthesizing: false },
    ]);
  });
});
