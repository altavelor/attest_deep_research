import {
  MAX_FINDING_CITATION_TOKENS,
  MAX_PLAN_LIST_ITEMS,
  MAX_RESEARCH_BRANCHES,
  MAX_RESEARCH_TEXT_CHARS,
} from "./limits";
import { budgetLimits } from "./budgetLimits";
import { isFindingText } from "./findingBounds";
import { MAX_RESEARCH_CLAIMS } from "./verification";
import { isResearchId, isRevision } from "./planValidation";
import { isSubAgentStateId } from "../subAgent/stateIds";
import type {
  BranchAllocation,
  BranchExecution,
  BranchFinding,
  BranchRunRef,
  ResearchBudgetState,
  ResearchPlan,
  ResearchReport,
  ResearchReportScale,
  ResearchReportSummary,
  ReportVerificationCounts,
} from "./types";

const EXECUTION_STATES: readonly BranchExecution["state"][] = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "blocked",
];
const CLOSE_REASONS = ["exhausted", "time"];
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

/** Reads the stored child session of each branch; a section written before sessions existed has none. */
export function readSessionByBranch(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (
    entries.length > MAX_RESEARCH_BRANCHES ||
    !entries.every(
      ([branchId, sessionId]) => isResearchId(branchId) && isSubAgentStateId(sessionId),
    )
  ) {
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Checks that executions, sessions, budget and report agree with the plan: executions name distinct
 * planned branches of an approved plan, child sessions belong to distinct planned branches within
 * the session ceiling, a run reference names its branch's session, every open allocation belongs to
 * a running execution, and an active research holds no report because a written report ends it.
 */
export function executionConsistent(
  plan: ResearchPlan | null,
  executions: readonly BranchExecution[],
  sessionByBranch: Readonly<Record<string, string>>,
  budget: ResearchBudgetState | null,
  report: unknown,
  followUps: readonly BranchExecution[] = [],
): boolean {
  if (report !== null) return false;
  if (executions.length > 0 && !plan?.approvedAt) return false;
  const branchIds = new Set(plan?.branches.map((branch) => branch.branchId) ?? []);
  const sessions = Object.entries(sessionByBranch);
  if (
    sessions.length > (plan?.approvedAt ? budgetLimits(plan).childSessions : 0) ||
    !sessions.every(([branchId]) => branchIds.has(branchId)) ||
    new Set(sessions.map(([, sessionId]) => sessionId)).size !== sessions.length
  ) {
    return false;
  }
  const seen = new Set<string>();
  for (const execution of executions) {
    if (!branchIds.has(execution.branchId) || seen.has(execution.workId)) return false;
    seen.add(execution.workId);
    if ((execution.state === "completed") !== (execution.finding !== null)) return false;
    if (!runRefConsistent(execution, sessionByBranch)) return false;
  }
  if (
    !followUps.every(
      (execution) =>
        branchIds.has(execution.branchId) &&
        !seen.has(execution.workId) &&
        runRefConsistent(execution, sessionByBranch),
    )
  ) {
    return false;
  }
  const all = [...executions, ...followUps];
  if (!budget) return all.every((execution) => execution.attempts === 0);
  if (plan && !budgetConsistent(plan, all, budget)) return false;
  return budget.openAllocations.every((allocation) =>
    all.some(
      (execution) =>
        execution.workId === allocation.workId &&
        execution.branchId === allocation.branchId &&
        execution.state === "running" &&
        execution.attempts === allocation.attempt,
    ),
  );
}

function runRefConsistent(
  execution: BranchExecution,
  sessionByBranch: Readonly<Record<string, string>>,
): boolean {
  const ref = execution.runRef;
  return (
    !ref ||
    (execution.path === "sub-agent" && sessionByBranch[execution.branchId] === ref.sessionId)
  );
}

/**
 * Checks the budget invariants the owner keeps: total attempts equal the per-branch counts, each
 * within its cap and at least the attempts of the branch's executions, and spent and open rounds
 * and searches within the plan limits. A closure during a wave may leave the allocations of the
 * works it is stopping open until each of them settles.
 */
function budgetConsistent(
  plan: ResearchPlan,
  executions: readonly BranchExecution[],
  budget: ResearchBudgetState,
): boolean {
  const limits = budgetLimits(plan);
  const counts = Object.values(budget.attemptsByBranch);
  const open = (key: "modelRounds" | "searches"): number =>
    budget.openAllocations.reduce((total, allocation) => total + allocation[key], 0);
  return (
    counts.reduce((total, count) => total + count, 0) === budget.consumed.branchAttempts &&
    budget.consumed.branchAttempts <= limits.attemptsTotal &&
    counts.every((count) => count <= limits.attemptsPerBranch) &&
    executions.every(
      (execution) => execution.attempts <= (budget.attemptsByBranch[execution.branchId] ?? 0),
    ) &&
    budget.consumed.modelRounds + open("modelRounds") <= limits.modelRoundsTotal &&
    budget.consumed.searches + open("searches") <= limits.searchesTotal
  );
}

/** Reads the report summary of a history entry, or returns undefined when it is malformed. */
export function readReportSummary(value: unknown): ResearchReportSummary | null | undefined {
  if (value === null) return null;
  const verification = isRecord(value) ? readReportCounts(value.verification) : undefined;
  if (
    verification === undefined ||
    !isRecord(value) ||
    !isResearchId(value.reportId) ||
    (value.quality !== "complete" && value.quality !== "partial") ||
    !isIdList(value.completedBranches) ||
    !Array.isArray(value.missingBranches) ||
    value.missingBranches.length > MAX_RESEARCH_BRANCHES ||
    !value.missingBranches.every(
      (entry) =>
        isRecord(entry) &&
        isResearchId(entry.branchId) &&
        isText(entry.reason) &&
        (entry.title === undefined || isText(entry.title)),
    ) ||
    readScale(value.scale) === null ||
    (value.summaryFailure !== undefined && !isText(value.summaryFailure)) ||
    !isText(value.stopReason) ||
    !isTimestamp(value.createdAt)
  ) {
    return undefined;
  }
  return {
    reportId: value.reportId,
    quality: value.quality,
    completedBranches: [...value.completedBranches],
    missingBranches: value.missingBranches.map((entry) => {
      const { branchId, reason, title } = entry as Record<string, string>;
      return { branchId: branchId!, reason: reason!, ...(title !== undefined ? { title } : {}) };
    }),
    stopReason: value.stopReason,
    createdAt: value.createdAt,
    verification,
    ...(value.scale !== undefined ? { scale: readScale(value.scale)! } : {}),
    ...(typeof value.summaryFailure === "string" ? { summaryFailure: value.summaryFailure } : {}),
  };
}

/** Reads the optional scale of a report summary: undefined when absent, null when malformed. */
function readScale(value: unknown): ResearchReportScale | null | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !isRevision(value.objectives) ||
    value.objectives > MAX_PLAN_LIST_ITEMS ||
    !isRevision(value.activeMs) ||
    !isRevision(value.activeLimitMs)
  ) {
    return null;
  }
  return {
    objectives: value.objectives,
    activeMs: value.activeMs,
    activeLimitMs: value.activeLimitMs,
  };
}

/** Reads the verification counts of a report summary; a summary written before verification has none. */
export function readReportCounts(value: unknown): ReportVerificationCounts | null | undefined {
  if (value === undefined || value === null) return null;
  if (
    !isRecord(value) ||
    !["supported", "conflicted", "unsupported", "unresolved"].every(
      (key) => isRevision(value[key]) && (value[key] as number) <= MAX_RESEARCH_CLAIMS,
    ) ||
    !Array.isArray(value.uncoveredObjectives) ||
    value.uncoveredObjectives.length > MAX_PLAN_LIST_ITEMS ||
    !value.uncoveredObjectives.every(isText) ||
    (value.coveredObjectives !== undefined &&
      !(isRevision(value.coveredObjectives) && value.coveredObjectives <= MAX_PLAN_LIST_ITEMS))
  ) {
    return undefined;
  }
  return {
    supported: value.supported as number,
    conflicted: value.conflicted as number,
    unsupported: value.unsupported as number,
    unresolved: value.unresolved as number,
    uncoveredObjectives: [...(value.uncoveredObjectives as string[])],
    ...(value.coveredObjectives !== undefined
      ? { coveredObjectives: value.coveredObjectives as number }
      : {}),
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

/** Reads one stored branch execution, or returns undefined when any field is malformed. */
export function readExecution(value: unknown): BranchExecution | undefined {
  if (!isRecord(value)) return undefined;
  const finding = value.finding === null ? null : readFinding(value.finding);
  const runRef = value.runRef === undefined ? null : readRunRef(value.runRef);
  if (
    runRef === undefined ||
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
    ...(runRef ? { runRef } : {}),
  };
}

function readRunRef(value: unknown): BranchRunRef | undefined {
  if (
    !isRecord(value) ||
    !isSubAgentStateId(value.sessionId) ||
    !isSubAgentStateId(value.runId) ||
    !isRevision(value.resultRevision)
  ) {
    return undefined;
  }
  return { sessionId: value.sessionId, runId: value.runId, resultRevision: value.resultRevision };
}

function readFinding(value: unknown): BranchFinding | undefined {
  if (
    !isRecord(value) ||
    !isFindingText(value.text) ||
    !Array.isArray(value.citationTokens) ||
    value.citationTokens.length > MAX_FINDING_CITATION_TOKENS ||
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
