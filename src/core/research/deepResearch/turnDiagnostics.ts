import type {
  DeepResearchChildRunDiagnostic,
  DeepResearchDiagnostics,
  DeepResearchTurnKind,
  DeepResearchWorkDiagnostic,
} from "@core/diagnostics";
import type { BranchExecution, BudgetDimension, ResearchLimits, ResearchState } from "./types";
import { budgetLimits } from "./budgetLimits";
import { stopReasonOf } from "./report";
import { ENGLISH_RESEARCH_LABELS } from "./reportLabels";

export const MAX_DIAGNOSTIC_TEXT_CHARS = 200;
export const MAX_DIAGNOSTIC_WORKS = 60;
export const MAX_DIAGNOSTIC_RUNS_PER_WORK = 6;
export const MAX_DIAGNOSTIC_ENTRIES = 40;

const LIMIT_OF: Record<BudgetDimension, keyof ResearchLimits> = {
  branchAttempts: "attemptsTotal",
  modelRounds: "modelRoundsTotal",
  searches: "searchesTotal",
  evidenceItems: "evidenceItemsTotal",
};

export interface DeepResearchTurnRecord {
  turnKind: DeepResearchTurnKind;
  before: ResearchState | null;
  after: ResearchState | null;
  runs: ReadonlyMap<string, readonly DeepResearchChildRunDiagnostic[]>;
}

/** Cuts an untrusted or free-form text to the diagnostic bound. */
export function boundDiagnosticText(text: string): string {
  return text.length <= MAX_DIAGNOSTIC_TEXT_CHARS
    ? text
    : `${text.slice(0, MAX_DIAGNOSTIC_TEXT_CHARS - 1)}…`;
}

/**
 * Summarizes one Deep Research turn from the research states before and after it and the branch
 * attempts it ran. Only sizes and counts of findings are kept, never their text, and every string
 * and list is bounded.
 */
export function deepResearchTurnDiagnostics(
  record: DeepResearchTurnRecord,
): DeepResearchDiagnostics {
  const state = record.after ?? record.before;
  const plan = state?.plan ?? null;
  const works = state ? workDiagnostics(state, record.runs) : [];
  const verification = state?.verification ?? null;
  const verdicts = verification?.assessments.map((entry) => entry.verdict) ?? [];
  const count = (verdict: string): number => verdicts.filter((entry) => entry === verdict).length;
  return {
    researchId: state?.researchId ?? null,
    turnKind: record.turnKind,
    phaseBefore: record.before?.phase ?? null,
    phaseAfter: record.after?.phase ?? null,
    terminalReason: optionalText(state?.terminalReason ?? null),
    stopReason: state?.budget ? stopReasonOf(state.budget, ENGLISH_RESEARCH_LABELS) : null,
    plan: plan && {
      revision: plan.revision,
      preset: plan.preset,
      limits: { ...budgetLimits(plan) },
      branches: plan.branches.slice(0, MAX_DIAGNOSTIC_ENTRIES).map((branch) => ({
        branchId: boundDiagnosticText(branch.branchId),
        title: boundDiagnosticText(branch.title),
        sourceScope: branch.sourceScope,
        enabled: branch.enabled,
        priority: branch.priority,
      })),
    },
    budget: state?.budget
      ? {
          consumed: (Object.keys(LIMIT_OF) as BudgetDimension[]).map((dimension) => ({
            dimension,
            used: state.budget!.consumed[dimension],
            limit: plan ? budgetLimits(plan)[LIMIT_OF[dimension]] : 0,
          })),
          activeMs: state.budget.activeMs,
          activeLimitMs: plan ? budgetLimits(plan).activeExecutionMs : null,
          closedReason: state.budget.closed?.reason ?? null,
          closedDimension: optionalText(state.budget.closed?.dimension ?? null),
          openAllocations: state.budget.openAllocations.length,
        }
      : null,
    works: works.slice(0, MAX_DIAGNOSTIC_WORKS),
    omittedWorks: Math.max(0, works.length - MAX_DIAGNOSTIC_WORKS),
    verification: verification && {
      claims: verification.claims.length,
      supported: count("supported"),
      unsupported: count("unsupported"),
      conflicted: count("conflicted"),
      unresolved: count("unresolved"),
      followUpsUsed: verification.followUpsUsed,
    },
    hypotheses: (state?.discovery?.hypotheses ?? [])
      .slice(0, MAX_DIAGNOSTIC_ENTRIES)
      .map((entry) => ({
        hypothesisId: boundDiagnosticText(entry.hypothesisId),
        status: entry.status,
      })),
    cycleDecisions: (state?.discovery?.cycles ?? [])
      .slice(0, MAX_DIAGNOSTIC_ENTRIES)
      .map((cycle) => ({
        ordinal: cycle.ordinal,
        decision: cycle.decision,
        reason: boundDiagnosticText(cycle.reason),
      })),
  };
}

function workDiagnostics(
  state: ResearchState,
  runs: ReadonlyMap<string, readonly DeepResearchChildRunDiagnostic[]>,
): DeepResearchWorkDiagnostic[] {
  const work = (kind: DeepResearchWorkDiagnostic["kind"]) => (execution: BranchExecution) =>
    workDiagnostic(kind, execution, state, runs.get(execution.workId) ?? []);
  return [
    ...state.executions.map(work("gather")),
    ...(state.verification?.followUps ?? []).map(work("follow-up")),
    ...(state.discovery?.executions ?? []).map(work("test")),
  ];
}

function workDiagnostic(
  kind: DeepResearchWorkDiagnostic["kind"],
  execution: BranchExecution,
  state: ResearchState,
  runs: readonly DeepResearchChildRunDiagnostic[],
): DeepResearchWorkDiagnostic {
  const session = execution.runRef?.sessionId ?? state.sessionByBranch[execution.branchId];
  const runner =
    execution.path === "sub-agent"
      ? `sub-agent ${session ?? "unknown"}`
      : (execution.path ?? "none");
  return {
    workId: boundDiagnosticText(execution.workId),
    kind,
    branchId: boundDiagnosticText(execution.branchId),
    runner: boundDiagnosticText(runner),
    state: execution.state,
    terminalReason: optionalText(execution.terminalReason),
    attempts: execution.attempts,
    findingChars: execution.finding?.text.length ?? 0,
    citationTokens: execution.finding?.citationTokens.length ?? 0,
    partial: execution.finding?.partial ?? false,
    runs: runs.slice(-MAX_DIAGNOSTIC_RUNS_PER_WORK),
  };
}

function optionalText(text: string | null): string | null {
  return text === null ? null : boundDiagnosticText(text);
}
