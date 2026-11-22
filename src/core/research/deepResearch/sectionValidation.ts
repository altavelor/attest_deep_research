import {
  DEEP_RESEARCH_SCHEMA,
  MAX_RESEARCH_HISTORY,
  MAX_RESEARCH_QUESTION_CHARS,
  MAX_RESEARCH_TEXT_CHARS,
  isTerminalResearchPhase,
} from "./limits";
import { isResearchId, isRevision, validatePlan } from "./planValidation";
import {
  executionConsistent,
  readBudget,
  readExecutions,
  readReportSummary,
  readSessionByBranch,
  reportSummary,
} from "./executionValidation";
import { readBrief, readVerification } from "./briefValidation";
import type {
  DeepResearchSection,
  PendingDecision,
  ResearchBranch,
  ResearchBrief,
  ResearchHistoryEntry,
  ResearchLimits,
  ResearchPhase,
  ResearchPlan,
  ResearchPreset,
  ResearchRuleResult,
  ResearchState,
} from "./types";

const PHASES: readonly ResearchPhase[] = [
  "planning",
  "awaiting-approval",
  "gathering",
  "verifying",
  "synthesizing",
  "awaiting-clarification",
  "discovering",
  "awaiting-observation",
  "completed",
  "failed",
  "cancelled",
];
const EXECUTING: readonly ResearchPhase[] = [
  "gathering",
  "verifying",
  "synthesizing",
  "discovering",
];
const REQUIRED_DECISION: Partial<Record<ResearchPhase, PendingDecision["kind"]>> = {
  "awaiting-approval": "plan",
  "awaiting-clarification": "clarification",
  "awaiting-observation": "observation",
};
const APPROVED_PHASES: readonly ResearchPhase[] = [...EXECUTING, "awaiting-observation"];
const DECISION_KINDS: readonly PendingDecision["kind"][] = [
  "plan",
  "clarification",
  "observation",
  "stale-plan",
];
const SCOPES: readonly ResearchBranch["sourceScope"][] = ["indexOnly", "webOnly", "indexAndWeb"];
const PRESETS: readonly ResearchPreset[] = ["conservative", "balanced", "thorough"];
const MAX_QUESTION = MAX_RESEARCH_QUESTION_CHARS;
const MAX_TEXT = MAX_RESEARCH_TEXT_CHARS;
const MAX_TIMESTAMP = 40;

/**
 * Validates a stored Deep Research section and rebuilds it from its validated fields only. Any
 * unknown schema, malformed field, invalid plan or inconsistent combination of phase, decision and
 * plan makes the whole section unreadable; it is never replaced by an empty default.
 */
export function validateResearchSection(value: unknown): ResearchRuleResult<DeepResearchSection> {
  if (!isRecord(value) || value.schema !== DEEP_RESEARCH_SCHEMA) {
    return { ok: false, message: "The research state has an unknown schema." };
  }
  const active = value.active === null ? null : readState(value.active);
  if (active === undefined) {
    return { ok: false, message: "The active research state is malformed." };
  }
  const history = Array.isArray(value.history) ? value.history.map(readHistoryEntry) : null;
  if (!history || history.length > MAX_RESEARCH_HISTORY || history.includes(null)) {
    return { ok: false, message: "The research history is malformed." };
  }
  return {
    ok: true,
    value: {
      schema: DEEP_RESEARCH_SCHEMA,
      active,
      history: history as ResearchHistoryEntry[],
    },
  };
}

/** Builds the section that follows a committed state; a finished research moves into history. */
export function nextResearchSection(
  section: DeepResearchSection | null,
  next: ResearchState,
): DeepResearchSection {
  const history = section?.history ?? [];
  if (!isTerminalResearchPhase(next.phase)) {
    return { schema: DEEP_RESEARCH_SCHEMA, active: next, history };
  }
  const entry: ResearchHistoryEntry = {
    researchId: next.researchId,
    question: next.question,
    phase: next.phase,
    terminalReason: next.terminalReason,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
    report: reportSummary(next.report),
  };
  return {
    schema: DEEP_RESEARCH_SCHEMA,
    active: null,
    history: [entry, ...history].slice(0, MAX_RESEARCH_HISTORY),
  };
}

function readState(value: unknown): ResearchState | undefined {
  if (!isRecord(value)) return undefined;
  const phase = value.phase as ResearchPhase;
  const pending = value.pending === null ? null : readPending(value.pending);
  const plan = value.plan === null ? null : readPlan(value.plan);
  const budget = readBudget(value.budget);
  const executions = readExecutions(value.executions);
  const sessionByBranch = readSessionByBranch(value.sessionByBranch);
  const brief = readBrief(value.brief);
  const verification =
    plan === undefined || executions === undefined
      ? undefined
      : readVerification(value.verification, plan, executions);
  if (
    value.schema !== DEEP_RESEARCH_SCHEMA ||
    !isResearchId(value.researchId) ||
    !isRevision(value.revision) ||
    !isText(value.question, MAX_QUESTION) ||
    !PHASES.includes(phase) ||
    isTerminalResearchPhase(phase) ||
    pending === undefined ||
    plan === undefined ||
    !(value.terminalReason === null || isText(value.terminalReason, MAX_TEXT)) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    !consistent(phase, pending, plan) ||
    brief === undefined ||
    verification === undefined ||
    !briefConsistent(phase, brief, plan) ||
    budget === undefined ||
    executions === undefined ||
    sessionByBranch === undefined ||
    !executionConsistent(
      plan,
      executions,
      sessionByBranch,
      budget,
      value.report,
      verification?.followUps ?? [],
    )
  ) {
    return undefined;
  }
  return {
    schema: DEEP_RESEARCH_SCHEMA,
    researchId: value.researchId,
    revision: value.revision,
    question: value.question,
    phase,
    pending,
    plan,
    terminalReason: value.terminalReason as string | null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    budget,
    executions,
    sessionByBranch,
    report: null,
    brief,
    verification,
  };
}

function briefConsistent(
  phase: ResearchPhase,
  brief: ResearchBrief | null,
  plan: ResearchPlan | null,
): boolean {
  if (phase !== "awaiting-clarification") return true;
  return (
    plan === null &&
    brief !== null &&
    brief.questions.length > 0 &&
    Object.keys(brief.answers).length === 0
  );
}

function consistent(
  phase: ResearchPhase,
  pending: PendingDecision | null,
  plan: ResearchPlan | null,
): boolean {
  const required = REQUIRED_DECISION[phase];
  if (required !== undefined && pending?.kind !== required) return false;
  if (required === undefined && pending !== null) {
    if (pending.kind !== "stale-plan" || !EXECUTING.includes(phase)) return false;
  }
  if (pending?.kind === "plan" || pending?.kind === "stale-plan") {
    if (!plan || pending.artifactRevision !== plan.revision) return false;
  }
  if (pending?.kind === "plan" && plan?.approvedAt !== null) return false;
  if (APPROVED_PHASES.includes(phase) && !plan?.approvedAt) return false;
  return true;
}

function readPending(value: unknown): PendingDecision | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.decisionId) ||
    !DECISION_KINDS.includes(value.kind as PendingDecision["kind"]) ||
    !isRevision(value.artifactRevision)
  ) {
    return undefined;
  }
  return {
    decisionId: value.decisionId,
    kind: value.kind as PendingDecision["kind"],
    artifactRevision: value.artifactRevision,
  };
}

function readPlan(value: unknown): ResearchPlan | undefined {
  if (!isRecord(value) || !isRecord(value.limits)) return undefined;
  const branches = Array.isArray(value.branches) ? value.branches.map(readBranch) : null;
  const preset = value.preset as ResearchPreset;
  if (
    !isResearchId(value.planId) ||
    !isRevision(value.revision) ||
    !isTextList(value.objectives) ||
    !isTextList(value.reportOutline) ||
    !isTextList(value.knownOmissions) ||
    !branches ||
    branches.includes(undefined) ||
    !PRESETS.includes(preset) ||
    !Object.values(value.limits).every(isRevision) ||
    !isRevision(value.generationsUsed) ||
    !(value.approvedAt === null || isTimestamp(value.approvedAt))
  ) {
    return undefined;
  }
  const plan: ResearchPlan = {
    planId: value.planId,
    revision: value.revision,
    objectives: [...value.objectives],
    reportOutline: [...value.reportOutline],
    branches: branches as ResearchBranch[],
    knownOmissions: [...value.knownOmissions],
    preset,
    limits: { ...(value.limits as unknown as ResearchLimits) },
    generationsUsed: value.generationsUsed,
    approvedAt: value.approvedAt as string | null,
  };
  return validatePlan(plan) === null ? plan : undefined;
}

function readBranch(value: unknown): ResearchBranch | undefined {
  if (
    !isRecord(value) ||
    !isResearchId(value.branchId) ||
    !isText(value.title, MAX_TEXT) ||
    !isText(value.task, MAX_TEXT) ||
    !isText(value.expectedOutput, MAX_TEXT) ||
    (value.priority !== "required" && value.priority !== "optional") ||
    typeof value.enabled !== "boolean" ||
    !isTextList(value.objectives) ||
    !SCOPES.includes(value.sourceScope as ResearchBranch["sourceScope"]) ||
    !Array.isArray(value.dependsOn) ||
    !value.dependsOn.every(isResearchId)
  ) {
    return undefined;
  }
  return {
    branchId: value.branchId,
    title: value.title,
    task: value.task,
    expectedOutput: value.expectedOutput,
    priority: value.priority,
    enabled: value.enabled,
    objectives: [...value.objectives],
    sourceScope: value.sourceScope as ResearchBranch["sourceScope"],
    dependsOn: [...(value.dependsOn as string[])],
  };
}

function readHistoryEntry(value: unknown): ResearchHistoryEntry | null {
  const report = isRecord(value) ? readReportSummary(value.report) : undefined;
  if (
    !isRecord(value) ||
    !isResearchId(value.researchId) ||
    !isText(value.question, MAX_QUESTION) ||
    !PHASES.includes(value.phase as ResearchPhase) ||
    !isTerminalResearchPhase(value.phase as ResearchPhase) ||
    !(value.terminalReason === null || isText(value.terminalReason, MAX_TEXT)) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    report === undefined
  ) {
    return null;
  }
  return {
    report,
    researchId: value.researchId,
    question: value.question,
    phase: value.phase as ResearchPhase,
    terminalReason: value.terminalReason as string | null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isTimestamp(value: unknown): value is string {
  return isText(value, MAX_TIMESTAMP) && !Number.isNaN(Date.parse(value));
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isText(entry, MAX_TEXT));
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
