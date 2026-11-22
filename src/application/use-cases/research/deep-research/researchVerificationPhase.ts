import {
  MAX_RESEARCH_CLAIMS,
  followUpWorks,
  objectiveCoverage,
  resumeExecutions,
  type BranchExecution,
  type ResearchPlan,
  type ResearchVerification,
  type ResearchWork,
  type VerificationSummary,
} from "@core/research/deepResearch";

export interface VerificationBounds {
  followUpsRemaining: number;
  cycle: number;
  claimAllowance: number;
}

export interface VerificationPhaseDeps {
  plan: ResearchPlan;
  executions(): readonly BranchExecution[];
  verification: ResearchVerification | null;
  verify(
    findings: readonly BranchExecution[],
    bounds: VerificationBounds,
  ): Promise<{ summary: VerificationSummary; extractedWorks: readonly string[] }>;
  runFollowUps(
    followUps: readonly BranchExecution[],
    works: readonly ResearchWork[],
  ): Promise<readonly BranchExecution[]>;
  commit(verification: ResearchVerification): Promise<void>;
  budgetOpen(): boolean;
  aborted(): boolean;
}

/**
 * Verifies every completed finding not yet verified, then runs at most one follow-up work per
 * branch the merged verification leaves uncovered or conflicted while the cap and budget allow, and re-verifies only the findings
 * the follow-ups produced. Pending follow-ups of an interrupted turn run before anything else.
 */
export async function runVerificationPhase(
  deps: VerificationPhaseDeps,
): Promise<ResearchVerification> {
  const { plan } = deps;
  const cap = plan.limits.verificationFollowUps;
  let current: ResearchVerification = deps.verification ?? {
    claims: [],
    assessments: [],
    coverage: objectiveCoverage(plan.objectives, [], []),
    verifiedWorks: [],
    followUps: [],
    followUpsUsed: 0,
  };
  const unsettled = current.followUps.filter(
    (execution) => execution.state === "pending" || execution.state === "running",
  );
  if (unsettled.length > 0 && deps.budgetOpen()) {
    const tasks = new Map(
      followUpWorks(
        plan,
        current,
        plan.branches.map((b) => b.branchId),
        cap,
        current.followUpsUsed,
      ).map((work) => [work.branchId, work.task]),
    );
    const works = unsettled.map((execution) => followUpWork(plan, execution, tasks));
    const settled = await deps.runFollowUps(resumeExecutions(current.followUps), works);
    current = { ...current, followUps: [...settled] };
  }
  for (;;) {
    if (deps.aborted()) return current;
    const verified = new Set(current.verifiedWorks);
    const changed = [...deps.executions(), ...current.followUps].filter(
      (execution) => execution.state === "completed" && !verified.has(execution.workId),
    );
    if (changed.length === 0) return current;
    const { summary, extractedWorks } = await deps.verify(changed, {
      followUpsRemaining: cap - current.followUpsUsed,
      cycle: current.followUpsUsed + 1,
      claimAllowance: MAX_RESEARCH_CLAIMS - current.claims.length,
    });
    if (deps.aborted()) return current;
    current = merged(plan, current, summary, extractedWorks);
    await deps.commit(current);
    if (extractedWorks.length === 0) return current;
    const works = followUpWorks(
      plan,
      current,
      completedBranches([...deps.executions(), ...current.followUps]),
      cap - current.followUpsUsed,
      current.followUpsUsed + 1,
    );
    if (works.length === 0 || !deps.budgetOpen()) return current;
    const followUps = works.map(pendingExecution);
    current = {
      ...current,
      followUps: [...current.followUps, ...followUps],
      followUpsUsed: current.followUpsUsed + followUps.length,
    };
    await deps.commit(current);
    const settled = await deps.runFollowUps(current.followUps, works);
    current = { ...current, followUps: [...settled] };
  }
}

function merged(
  plan: ResearchPlan,
  previous: ResearchVerification,
  summary: VerificationSummary,
  extractedWorks: readonly string[],
): ResearchVerification {
  const claims = [...previous.claims, ...summary.claims];
  const assessments = [...previous.assessments, ...summary.assessments];
  return {
    ...previous,
    claims,
    assessments,
    coverage: objectiveCoverage(plan.objectives, claims, assessments),
    verifiedWorks: [...previous.verifiedWorks, ...extractedWorks],
  };
}

function completedBranches(executions: readonly BranchExecution[]): string[] {
  return [
    ...new Set(
      executions
        .filter((execution) => execution.state === "completed")
        .map((execution) => execution.branchId),
    ),
  ];
}

function pendingExecution(work: ResearchWork): BranchExecution {
  return {
    workId: work.workId,
    branchId: work.branchId,
    state: "pending",
    path: null,
    attempts: 0,
    finding: null,
    terminalReason: null,
  };
}

function followUpWork(
  plan: ResearchPlan,
  execution: BranchExecution,
  tasks: ReadonlyMap<string, string>,
): ResearchWork {
  const branch = plan.branches.find((entry) => entry.branchId === execution.branchId);
  return {
    workId: execution.workId,
    branchId: execution.branchId,
    cycle: 1,
    kind: "follow-up",
    task: tasks.get(execution.branchId) ?? `Follow up on "${branch?.title}": ${branch?.task}`,
  };
}
