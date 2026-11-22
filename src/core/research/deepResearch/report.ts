import { supportedClaimsSection, uncoveredRequired, verificationSections } from "./reportSections";
import type {
  BranchExecution,
  ResearchVerification,
  ResearchBudgetState,
  ResearchPlan,
  ResearchReport,
  StalePlanDecisionPayload,
} from "./types";

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
 * Decides what a finished run yields: no completed branch, or verified claims none of which is
 * supported, fails the research. The report is complete only when its claims were verified, every
 * required objective is covered and no required branch is missing; otherwise it is partial.
 */
export function reportDecision(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
  stopReason: string,
  verification: ResearchVerification | null = null,
): ReportDecision {
  const completed = executions.filter((execution) => execution.state === "completed");
  if (completed.length === 0) {
    return { kind: "failed", reason: `No branch completed. ${stopReason}` };
  }
  const verified = verification !== null && verification.assessments.length > 0;
  if (verified && !verification.assessments.some((entry) => entry.verdict === "supported")) {
    return {
      kind: "failed",
      reason: `No claim of the findings is supported by its sources. ${stopReason}`,
    };
  }
  const missing = executions.filter((execution) => execution.state !== "completed");
  const required = new Set(
    plan.branches
      .filter((branch) => branch.priority === "required")
      .map((branch) => branch.branchId),
  );
  return {
    kind: "report",
    quality:
      verified &&
      uncoveredRequired(plan, verification).length === 0 &&
      !missing.some((execution) => required.has(execution.branchId))
        ? "complete"
        : "partial",
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
 * Formats the report without any model or tool call. With assessments it lists the supported
 * claims and the verification sections; without them it lists the findings of every completed
 * branch with their citations, labelled unverified, then the missing branches and stop reason.
 */
export function formatWithoutModel(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
  stopReason: string,
  verification: ResearchVerification | null = null,
): string {
  if (verification && verification.assessments.length > 0) {
    const supported = supportedClaimsSection(verification);
    return [
      "# Research findings",
      "Verified claims are listed without a synthesized summary.",
      ...(supported ? ["## Supported claims", supported] : []),
      verificationSections(plan, executions, verification, stopReason),
    ].join("\n\n");
  }
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
    `Unverified findings are listed per branch without a synthesized summary; their claims were not checked against the sources. ${stopReason}`,
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

/** Reads the untrusted payload of a stale-plan decision, or returns null when it is malformed. */
export function parseStalePlanPayload(value: unknown): StalePlanDecisionPayload["action"] | null {
  const action =
    typeof value === "object" && value !== null ? (value as { action?: unknown }).action : null;
  return action === "continue" || action === "replan" || action === "cancel" ? action : null;
}
