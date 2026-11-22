import type { BranchExecution, ResearchBudgetState, ResearchPlan, ResearchReport } from "./types";

const HOUR_MS = 3_600_000;
const WEB_STALE_MS = 24 * HOUR_MS;
const INDEX_STALE_MS = 7 * 24 * HOUR_MS;

export type ReportDecision =
  | { kind: "failed"; reason: string }
  | {
      kind: "report";
      quality: ResearchReport["quality"];
      completedBranches: string[];
      missingBranches: { branchId: string; reason: string }[];
    };

/**
 * Decides what a finished run yields: no completed branch fails the research, a missing required
 * branch makes the report partial, otherwise it is complete. Missing branches keep their reason.
 */
export function reportDecision(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
  stopReason: string,
): ReportDecision {
  const completed = executions.filter((execution) => execution.state === "completed");
  if (completed.length === 0) {
    return { kind: "failed", reason: `No branch completed. ${stopReason}` };
  }
  const missing = executions.filter((execution) => execution.state !== "completed");
  const required = new Set(
    plan.branches
      .filter((branch) => branch.priority === "required")
      .map((branch) => branch.branchId),
  );
  return {
    kind: "report",
    quality: missing.some((execution) => required.has(execution.branchId)) ? "partial" : "complete",
    completedBranches: completed.map((execution) => execution.branchId),
    missingBranches: missing.map((execution) => ({
      branchId: execution.branchId,
      reason: execution.terminalReason ?? stopReason,
    })),
  };
}

/** Names why the run stopped, from the budget closure or the normal end of the plan. */
export function stopReasonOf(budget: ResearchBudgetState | null): string {
  const closed = budget?.closed;
  if (!closed) return "All scheduled branches settled.";
  if (closed.reason === "time") return "The active execution time limit was reached.";
  if (closed.reason === "user") return "Stopped by the user.";
  return `The research budget is exhausted (${closed.dimension ?? "budget"}).`;
}

/**
 * Formats the report without any model or tool call: the findings of every completed branch with
 * their citations, the branches that are missing and the stop reason.
 */
export function formatWithoutModel(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
  stopReason: string,
): string {
  const titleOf = (branchId: string): string =>
    plan.branches.find((branch) => branch.branchId === branchId)?.title ?? branchId;
  const sections = executions
    .filter((execution) => execution.state === "completed" && execution.finding)
    .map((execution) => {
      const finding = execution.finding!;
      const citations =
        finding.citationTokens.length > 0
          ? `\n\nSources: ${finding.citationTokens.map((token) => `[${token}]`).join(" ")}`
          : "";
      return `## ${titleOf(execution.branchId)}\n\n${finding.text.trim()}${citations}`;
    });
  const missing = executions
    .filter((execution) => execution.state !== "completed")
    .map(
      (execution) => `- ${titleOf(execution.branchId)}: ${execution.terminalReason ?? stopReason}`,
    );
  return [
    "# Research findings",
    `Findings are listed per branch without a synthesized summary. ${stopReason}`,
    ...sections,
    ...(missing.length > 0 ? ["## Missing branches", missing.join("\n")] : []),
  ].join("\n\n");
}

/**
 * Tells whether an approved plan is too old to continue without a decision: 24 hours with an
 * enabled web branch, seven days otherwise. The boundary itself counts as stale.
 */
export function isPlanStale(plan: ResearchPlan, now: string): boolean {
  if (!plan.approvedAt) return false;
  const web = plan.branches.some((branch) => branch.enabled && branch.sourceScope !== "indexOnly");
  const age = Date.parse(now) - Date.parse(plan.approvedAt);
  return age >= (web ? WEB_STALE_MS : INDEX_STALE_MS);
}
