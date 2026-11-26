import type { BranchExecution, ResearchBranch, ResearchPlan } from "./types";

export type BranchProgressStatus =
  "done" | "partial" | "running" | "waiting" | "failed" | "blocked" | "skipped";

export interface BranchProgressRow {
  number: number;
  branch: ResearchBranch;
  status: BranchProgressStatus;
  execution: BranchExecution | null;
  after: readonly number[];
}

export const BRANCH_PROGRESS_STATUSES: readonly BranchProgressStatus[] = [
  "done",
  "partial",
  "running",
  "waiting",
  "failed",
  "blocked",
  "skipped",
];

/**
 * Builds one progress row per enabled plan branch, numbered by its place in the plan. A row shows
 * the branch's latest execution: a completed one with a partial finding is partial, and a branch
 * that has not run yet is waiting. Dependencies are given as plan numbers.
 */
export function branchProgressRows(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
): BranchProgressRow[] {
  const numbers = new Map(plan.branches.map((branch, index) => [branch.branchId, index + 1]));
  const latest = new Map<string, BranchExecution>();
  for (const execution of executions) latest.set(execution.branchId, execution);
  return plan.branches
    .filter((branch) => branch.enabled)
    .map((branch) => {
      const execution = latest.get(branch.branchId) ?? null;
      return {
        number: numbers.get(branch.branchId)!,
        branch,
        status: executionProgressStatus(execution),
        execution,
        after: branch.dependsOn.flatMap((id) => numbers.get(id) ?? []),
      };
    });
}

/** Counts the rows of each status, leaving out the statuses no row has. */
export function branchProgressCounts(
  rows: readonly BranchProgressRow[],
): [BranchProgressStatus, number][] {
  return BRANCH_PROGRESS_STATUSES.map((status): [BranchProgressStatus, number] => [
    status,
    rows.filter((row) => row.status === status).length,
  ]).filter(([, count]) => count > 0);
}

/** Reads the progress status of one execution; a completed one with a partial finding is partial. */
export function executionProgressStatus(execution: BranchExecution | null): BranchProgressStatus {
  switch (execution?.state) {
    case "completed":
      return execution.finding?.partial ? "partial" : "done";
    case "running":
    case "failed":
    case "blocked":
    case "skipped":
      return execution.state;
    default:
      return "waiting";
  }
}
