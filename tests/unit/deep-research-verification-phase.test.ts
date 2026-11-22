import { runVerificationPhase } from "@application/use-cases/research/deep-research/researchVerificationPhase";
import {
  followUpWorks,
  objectiveCoverage,
  type BranchExecution,
  type ClaimAssessment,
  type ResearchClaim,
} from "@core/research/deepResearch";
import { gatheringResearch, researchBranch, researchPlan } from "../support/deepResearch";

const plan = researchPlan(
  [researchBranch(1), researchBranch(2, { objectives: ["Objective", "Second"] })],
  "thorough",
  { objectives: ["Objective", "Second"], approvedAt: "2026-01-01T00:00:00.000Z" },
);
const finding = { text: "F", citationTokens: [], partial: false };
const completed = gatheringResearch(plan).executions.map((execution): BranchExecution => ({
  ...execution,
  state: "completed",
  attempts: 1,
  finding,
}));

function verdict(claimId: string, supported: boolean): ClaimAssessment {
  return {
    claimId,
    verdict: supported ? "supported" : "unresolved",
    quote: supported ? "quote" : null,
    contradictingTokens: [],
    independenceGroups: [],
  };
}

describe("deep research verification phase", () => {
  it("decides follow-ups from the merged verification, not from the latest round alone", async () => {
    const rounds: string[][] = [];
    const verification = await runVerificationPhase({
      plan,
      executions: () => completed,
      verification: null,
      verify: async (findings, bounds) => {
        rounds.push(findings.map((execution) => execution.workId));
        const claims: ResearchClaim[] = findings.map((execution) => ({
          claimId: `c-${execution.workId}-1`,
          branchId: execution.branchId,
          objective: execution.workId.includes("follow-up") ? "Second" : "Objective",
          text: "Claim",
          citationTokens: [],
        }));
        const assessments = claims.map((claim) =>
          verdict(claim.claimId, claim.branchId === "branch-1" || claim.objective === "Second"),
        );
        const coverage = objectiveCoverage(plan.objectives, claims, assessments);
        const summary = {
          claims,
          assessments,
          coverage,
          followUps: followUpWorks(
            plan,
            { claims, assessments, coverage },
            findings.map((execution) => execution.branchId),
            bounds.followUpsRemaining,
            bounds.cycle,
          ),
        };
        return { summary, extractedWorks: findings.map((execution) => execution.workId) };
      },
      runFollowUps: async (followUps) =>
        followUps.map((execution) => ({ ...execution, state: "completed", attempts: 2, finding })),
      commit: async () => undefined,
      budgetOpen: () => true,
      aborted: () => false,
    });

    expect(rounds).toEqual([["branch-1-gather-1", "branch-2-gather-1"], ["branch-2-follow-up-1"]]);
    expect(verification.followUps.map((execution) => execution.workId)).toEqual([
      "branch-2-follow-up-1",
    ]);
    expect(verification.coverage.every((entry) => entry.covered)).toBe(true);
  });
});
