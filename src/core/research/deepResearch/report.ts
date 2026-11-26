import { label, type ResearchLabels } from "./reportLabels";
import { budgetLimits } from "./budgetLimits";
import type {
  BranchExecution,
  ResearchMissingBranch,
  ResearchReportScale,
  ResearchBudgetState,
  ResearchPlan,
  ResearchReport,
  StalePlanDecisionPayload,
} from "./types";

const HOUR_MS = 3_600_000;
const MAX_MISSING_TITLE_CHARS = 200;
const WEB_STALE_MS = 24 * HOUR_MS;
const INDEX_STALE_MS = 7 * 24 * HOUR_MS;

export type ReportDecision =
  | { kind: "failed"; reason: string }
  | {
      kind: "report";
      quality: ResearchReport["quality"];
      completedBranches: string[];
      missingBranches: ResearchMissingBranch[];
    };

/**
 * Decides what a finished run yields: only a run without a completed branch fails. The report is
 * complete when no required branch is missing; otherwise it is partial.
 */
export function reportDecision(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
  stopReason: string,
  labels: ResearchLabels,
): ReportDecision {
  const completed = executions.filter((execution) => execution.state === "completed");
  if (completed.length === 0) {
    return { kind: "failed", reason: label(labels, "noBranchCompleted", { reason: stopReason }) };
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
    missingBranches: missing.map((execution) => {
      const title = plan.branches.find((branch) => branch.branchId === execution.branchId)?.title;
      return {
        branchId: execution.branchId,
        reason: execution.terminalReason ?? stopReason,
        ...(title ? { title: title.slice(0, MAX_MISSING_TITLE_CHARS) } : {}),
      };
    }),
  };
}

/** Records the scale a report is read against: the plan's objectives and the research time. */
export function reportScale(plan: ResearchPlan, activeMs: number): ResearchReportScale {
  return {
    objectives: plan.objectives.length,
    activeMs: Math.max(0, Math.floor(activeMs)),
    activeLimitMs: budgetLimits(plan).activeExecutionMs,
  };
}

/** Names why the run stopped, from the budget closure or the normal end of the plan. */
export function stopReasonOf(budget: ResearchBudgetState | null, labels: ResearchLabels): string {
  const closed = budget?.closed;
  if (!closed) return labels.stopSettled;
  if (closed.reason === "time") return labels.stopTime;
  if (closed.reason === "user") return labels.stopUser;
  return label(labels, "stopBudget", { dimension: dimensionName(closed.dimension, labels) });
}

function dimensionName(dimension: string | null, labels: ResearchLabels): string {
  if (dimension === "branchAttempts") return labels.dimensionBranchAttempts;
  if (dimension === "modelRounds") return labels.dimensionModelRounds;
  if (dimension === "searches") return labels.dimensionSearches;
  if (dimension === "evidenceItems") return labels.dimensionEvidenceItems;
  return dimension ?? labels.dimensionBudget;
}

/**
 * Formats the report without any model or tool call: the findings of every completed branch with
 * their citations, then the missing branches and the stop reason.
 */
export function formatWithoutModel(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
  stopReason: string,
  labels: ResearchLabels,
): string {
  const titleOf = (branchId: string): string =>
    plan.branches.find((branch) => branch.branchId === branchId)?.title ?? branchId;
  const sections = executions
    .filter((execution) => execution.state === "completed" && execution.finding)
    .map((execution) => {
      const finding = execution.finding!;
      const citations =
        finding.citationTokens.length > 0
          ? `\n\n${label(labels, "sources", { tokens: finding.citationTokens.map((token) => `[${token}]`).join(" ") })}`
          : "";
      return `## ${titleOf(execution.branchId)}\n\n${finding.text.trim()}${citations}`;
    });
  const missing = executions
    .filter((execution) => execution.state !== "completed")
    .map(
      (execution) => `- ${titleOf(execution.branchId)}: ${execution.terminalReason ?? stopReason}`,
    );
  return [
    `# ${labels.findingsTitle}`,
    `${labels.unverifiedIntro} ${stopReason}`,
    ...sections,
    ...(missing.length > 0 ? [`## ${labels.missingBranches}`, missing.join("\n")] : []),
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
