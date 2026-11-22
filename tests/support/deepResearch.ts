import {
  presetLimits,
  withPlanForReview,
  startResearchState,
  type ResearchBranch,
  type ResearchPlan,
  type ResearchPreset,
  type ResearchState,
} from "@core/research/deepResearch";

/** Builds an enabled required branch covering the first objective. */
export function researchBranch(index: number, patch: Partial<ResearchBranch> = {}): ResearchBranch {
  return {
    branchId: `branch-${index}`,
    title: `Branch ${index}`,
    task: `Investigate aspect ${index}`,
    expectedOutput: "Findings",
    priority: "required",
    enabled: true,
    objectives: ["Objective"],
    sourceScope: "indexOnly",
    dependsOn: [],
    ...patch,
  };
}

/** Builds a valid plan with the given branches and the preset limits row. */
export function researchPlan(
  branches: readonly ResearchBranch[] = [researchBranch(1), researchBranch(2)],
  preset: ResearchPreset = "thorough",
  patch: Partial<ResearchPlan> = {},
): ResearchPlan {
  return {
    planId: "plan-1",
    revision: 1,
    objectives: ["Objective"],
    reportOutline: ["Summary"],
    branches,
    knownOmissions: [],
    preset,
    limits: presetLimits(preset),
    generationsUsed: 1,
    approvedAt: null,
    ...patch,
  };
}

/** Builds a research awaiting approval of the given plan. */
export function pendingResearch(plan: ResearchPlan = researchPlan()): ResearchState {
  return withPlanForReview(
    startResearchState("research-1", "Question", "2026-01-01T00:00:00.000Z"),
    plan,
    "decision-1",
    "2026-01-01T00:00:00.000Z",
  );
}

/** Returns the model reply of a valid two-branch plan as the plan generator expects it. */
export function planReply(): string {
  return JSON.stringify({
    objectives: ["Understand the topic"],
    reportOutline: ["Overview"],
    knownOmissions: [],
    branches: [
      { title: "Background", task: "Collect background", expectedOutput: "Notes", objectives: [1] },
      { title: "Details", task: "Collect details", expectedOutput: "Notes", dependsOn: [1] },
    ],
  });
}
