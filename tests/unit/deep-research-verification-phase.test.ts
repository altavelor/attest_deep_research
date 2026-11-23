import { runVerificationPhase } from "@application/use-cases/research/deep-research/researchVerificationPhase";
import {
  emptyBudgetState,
  followUpWorks,
  validateResearchSection,
  objectiveCoverage,
  type BranchExecution,
  type ClaimAssessment,
  type ResearchClaim,
} from "@core/research/deepResearch";
import { runResearch } from "@application/use-cases/research/deep-research/researchRun";
import type { ReportSynthesisService } from "@application/use-cases/research/deep-research";
import {
  MemoryResearchState,
  gatheringResearch,
  researchBranch,
  researchPlan,
} from "../support/deepResearch";

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
          workId: execution.workId,
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

  it("resumes a follow-up of a dead turn without counting it again or refunding its allocation", async () => {
    const single = researchPlan([researchBranch(1)], "thorough", {
      approvedAt: "2026-01-01T00:00:00.000Z",
    });
    const followUp: BranchExecution = {
      workId: "branch-1-follow-up-1",
      branchId: "branch-1",
      state: "running",
      path: "main",
      attempts: 2,
      finding: null,
      terminalReason: null,
    };
    const dead = {
      ...gatheringResearch(single),
      phase: "verifying" as const,
      executions: [{ ...completed[0]!, finding }],
      verification: {
        claims: [],
        assessments: [],
        coverage: [{ objective: "Objective", covered: false }],
        verifiedWorks: ["branch-1-gather-1"],
        followUps: [followUp],
        followUpsUsed: 1,
      },
      budget: {
        ...emptyBudgetState(),
        consumed: { branchAttempts: 2, modelRounds: 10, searches: 2, evidenceItems: 0 },
        attemptsByBranch: { "branch-1": 2 },
        openAllocations: [
          {
            workId: followUp.workId,
            branchId: "branch-1",
            attempt: 2,
            modelRounds: 12,
            searches: 5,
          },
        ],
      },
    };
    const stored = validateResearchSection(
      JSON.parse(JSON.stringify({ schema: 1, active: dead, history: [] })),
    );
    const port = new MemoryResearchState();
    await runResearch(stored.ok ? stored.value.active! : dead, {
      port,
      runner: {
        path: "main",
        run: async () => finding,
        usage: () => ({ modelRounds: 3, searches: 1, evidenceItems: 0 }),
      },
      synthesis: {} as ReportSynthesisService,
      createVerifier: (options) => ({
        verify: async (findings) => {
          options.onExtracted?.(findings.map((execution) => execution.workId));
          const claims = findings.map((execution) => ({
            claimId: `c-${execution.workId}-1`,
            workId: execution.workId,
            branchId: "branch-1",
            objective: "Objective",
            text: "Claim",
            citationTokens: [],
          }));
          const assessments = claims.map((entry) => verdict(entry.claimId, true));
          const coverage = objectiveCoverage(single.objectives, claims, assessments);
          return { claims, assessments, coverage, followUps: [] };
        },
      }),
      now: () => new Date("2026-01-01T01:00:00.000Z"),
      setTimer: () => () => undefined,
      createId: (prefix) => `${prefix}-1`,
      onState: () => undefined,
      onStatus: () => undefined,
    });

    expect(stored.ok).toBe(true);
    const settled = port.commits.find(
      (state) => state.verification?.followUps[0]?.state === "completed",
    )!;
    expect(settled.verification).toMatchObject({
      followUpsUsed: 1,
      followUps: [{ workId: followUp.workId, attempts: 3 }],
    });
    expect(settled.budget!.consumed).toMatchObject({ branchAttempts: 3, modelRounds: 25 });
    expect(port.commits.at(-1)!.phase).toBe("completed");
  });

  it("writes the report of a dead synthesizing turn without spending a gathering or verification round", async () => {
    const port = new MemoryResearchState();
    const createVerifier = vi.fn();
    const { report } = await runResearch(
      { ...gatheringResearch(plan), phase: "synthesizing", executions: completed },
      {
        port,
        runner: { path: "main", run: vi.fn(), usage: vi.fn() },
        synthesis: {} as ReportSynthesisService,
        createVerifier,
        now: () => new Date("2026-01-01T01:00:00.000Z"),
        setTimer: () => () => undefined,
        createId: (prefix) => `${prefix}-1`,
        onState: () => undefined,
        onStatus: () => undefined,
      },
    );

    expect(port.commits.map((state) => state.phase)).toEqual(["synthesizing", "completed"]);
    expect(createVerifier).not.toHaveBeenCalled();
    expect(port.commits.at(-1)!.budget!.consumed.branchAttempts).toBe(0);
    expect(report?.completedBranches).toHaveLength(2);
  });
});
