import { MAX_BRANCH_FINDING_CHARS, MAX_RESEARCH_BRANCHES, MAX_RESEARCH_TEXT_CHARS } from "./limits";
import { isResearchId, isRevision } from "./planValidation";
import type {
  BranchAllocation,
  BranchExecution,
  BranchFinding,
  ResearchBudgetState,
  ResearchPlan,
  ResearchReport,
  ResearchReportSummary,
} from "./types";

const EXECUTION_STATES: readonly BranchExecution["state"][] = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "blocked",
];
const CLOSE_REASONS = ["exhausted", "time", "user"];
const MAX_TOKENS = 200;
const MAX_TOKEN_CHARS = 200;
const MAX_TIMESTAMP = 40;

/** Reads a stored budget snapshot, or returns undefined when any field is malformed. */
export function readBudget(value: unknown): ResearchBudgetState | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isRecord(value.consumed) || !isRecord(value.attemptsByBranch)) return;
  const { consumed, attemptsByBranch, diagnostics, closed } = value;
  const allocations = Array.isArray(value.openAllocations)
    ? value.openAllocations.map(readAllocation)
    : null;
  if (
    !["branchAttempts", "modelRounds", "searches", "evidenceItems"].every((key) =>
      isRevision(consumed[key]),
    ) ||
    !Object.entries(attemptsByBranch).every(
      ([key, count]) => isResearchId(key) && isRevision(count),
    ) ||
    !isRevision(value.activeMs) ||
    !allocations ||
    allocations.length > MAX_RESEARCH_BRANCHES ||
    allocations.includes(undefined) ||
    !(closed === null || readClosed(closed)) ||
    !isRecord(diagnostics) ||
    !(diagnostics.inputTokens === null || isRevision(diagnostics.inputTokens)) ||
    !(diagnostics.outputTokens === null || isRevision(diagnostics.outputTokens)) ||
    !isRevision(diagnostics.fetches)
  ) {
    return undefined;
  }
  return {
    consumed: {
      branchAttempts: consumed.branchAttempts as number,
      modelRounds: consumed.modelRounds as number,
      searches: consumed.searches as number,
      evidenceItems: consumed.evidenceItems as number,
    },
    attemptsByBranch: { ...(attemptsByBranch as Record<string, number>) },
    activeMs: value.activeMs,
    openAllocations: allocations as BranchAllocation[],
    closed: closed === null ? null : readClosed(closed)!,
    diagnostics: {
      inputTokens: diagnostics.inputTokens as number | null,
      outputTokens: diagnostics.outputTokens as number | null,
      fetches: diagnostics.fetches,
    },
  };
}

/** Reads the stored branch executions, or returns undefined when any entry is malformed. */
export function readExecutions(value: unknown): BranchExecution[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_RESEARCH_BRANCHES) return undefined;
  const executions = value.map(readExecution);
  return executions.includes(undefined) ? undefined : (executions as BranchExecution[]);
}

/**
 * Checks that executions, budget and report agree with the plan: executions name distinct planned
 * branches of an approved plan, every open allocation belongs to a running execution, and an active
 * research holds no report because a written report ends it.
 */
export function executionConsistent(
  plan: ResearchPlan | null,
  executions: readonly BranchExecution[],
  budget: ResearchBudgetState | null,
  report: unknown,
): boolean {
  if (report !== null) return false;
  if (executions.length > 0 && !plan?.approvedAt) return false;
  const branchIds = new Set(plan?.branches.map((branch) => branch.branchId) ?? []);
  const seen = new Set<string>();
  for (const execution of executions) {
    if (!branchIds.has(execution.branchId) || seen.has(execution.workId)) return false;
    seen.add(execution.workId);
    if ((execution.state === "completed") !== (execution.finding !== null)) return false;
  }
  return (budget?.openAllocations ?? []).every((allocation) =>
    executions.some(
      (execution) =>
        execution.workId === allocation.workId &&
        execution.branchId === allocation.branchId &&
        execution.state === "running" &&
        execution.attempts === allocation.attempt,
    ),
  );
}

/** Reads the report summary of a history entry, or returns undefined when it is malformed. */
export function readReportSummary(value: unknown): ResearchReportSummary | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !isResearchId(value.reportId) ||
    (value.quality !== "complete" && value.quality !== "partial") ||
    !isIdList(value.completedBranches) ||
    !Array.isArray(value.missingBranches) ||
    value.missingBranches.length > MAX_RESEARCH_BRANCHES ||
    !value.missingBranches.every(
      (entry) => isRecord(entry) && isResearchId(entry.branchId) && isText(entry.reason),
    ) ||
    !isText(value.stopReason) ||
    !isTimestamp(value.createdAt)
  ) {
    return undefined;
  }
  return {
    reportId: value.reportId,
    quality: value.quality,
    completedBranches: [...value.completedBranches],
    missingBranches: value.missingBranches.map((entry) => ({
      branchId: (entry as Record<string, string>).branchId!,
      reason: (entry as Record<string, string>).reason!,
    })),
    stopReason: value.stopReason,
    createdAt: value.createdAt,
  };
}

/** Returns the report without its markdown, as a finished research keeps it in history. */
export function reportSummary(report: ResearchReport | null): ResearchReportSummary | null {
  if (!report) return null;
  const { markdown: _markdown, ...summary } = report;
  return summary;
}

function readAllocation(value: unknown): BranchAllocation | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.workId) ||
    !isResearchId(value.branchId) ||
    !isRevision(value.attempt) ||
    !isRevision(value.modelRounds) ||
    !isRevision(value.searches)
  ) {
    return undefined;
  }
  return {
    workId: value.workId,
    branchId: value.branchId,
    attempt: value.attempt,
    modelRounds: value.modelRounds,
    searches: value.searches,
  };
}

function readClosed(value: unknown): ResearchBudgetState["closed"] | undefined {
  if (
    !isRecord(value) ||
    !CLOSE_REASONS.includes(value.reason as string) ||
    !(
      value.dimension === null ||
      (typeof value.dimension === "string" && value.dimension.length <= 40)
    )
  ) {
    return undefined;
  }
  return {
    reason: value.reason as "exhausted" | "time" | "user",
    dimension: value.dimension as string | null,
  };
}

function readExecution(value: unknown): BranchExecution | undefined {
  if (!isRecord(value)) return undefined;
  const finding = value.finding === null ? null : readFinding(value.finding);
  if (
    !isResearchId(value.workId) ||
    !isResearchId(value.branchId) ||
    !EXECUTION_STATES.includes(value.state as BranchExecution["state"]) ||
    !(value.path === null || value.path === "main" || value.path === "sub-agent") ||
    !isRevision(value.attempts) ||
    finding === undefined ||
    !(value.terminalReason === null || isText(value.terminalReason))
  ) {
    return undefined;
  }
  return {
    workId: value.workId,
    branchId: value.branchId,
    state: value.state as BranchExecution["state"],
    path: value.path,
    attempts: value.attempts,
    finding,
    terminalReason: value.terminalReason as string | null,
  };
}

function readFinding(value: unknown): BranchFinding | undefined {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    value.text.length > MAX_BRANCH_FINDING_CHARS ||
    !Array.isArray(value.citationTokens) ||
    value.citationTokens.length > MAX_TOKENS ||
    !value.citationTokens.every(
      (token) => typeof token === "string" && token.length > 0 && token.length <= MAX_TOKEN_CHARS,
    ) ||
    typeof value.partial !== "boolean"
  ) {
    return undefined;
  }
  return { text: value.text, citationTokens: [...value.citationTokens], partial: value.partial };
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_RESEARCH_BRANCHES && value.every(isResearchId);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= MAX_TIMESTAMP && !Number.isNaN(Date.parse(value))
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_RESEARCH_TEXT_CHARS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
