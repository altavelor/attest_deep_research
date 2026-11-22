import { DEEP_RESEARCH_SCHEMA, MAX_RESEARCH_HISTORY, isTerminalResearchPhase } from "./limits";
import { isResearchId, isRevision, validatePlan } from "./planValidation";
import type {
  DeepResearchSection,
  PendingDecision,
  ResearchBranch,
  ResearchHistoryEntry,
  ResearchPhase,
  ResearchPlan,
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
const DECISION_KINDS = ["plan", "clarification", "observation", "stale-plan"];
const SCOPES = ["indexOnly", "webOnly", "indexAndWeb"];
const PRESETS = ["conservative", "balanced", "thorough"];
const MAX_QUESTION = 20_000;

/**
 * Validates a stored Deep Research section. Any unknown schema, malformed field or invalid
 * plan makes the whole section unreadable; it is never replaced by an empty default.
 */
export function validateResearchSection(value: unknown): ResearchRuleResult<DeepResearchSection> {
  if (!isRecord(value) || value.schema !== DEEP_RESEARCH_SCHEMA) {
    return { ok: false, message: "The research state has an unknown schema." };
  }
  const { active, history } = value;
  if (active !== null && !isResearchState(active)) {
    return { ok: false, message: "The active research state is malformed." };
  }
  if (
    !Array.isArray(history) ||
    history.length > MAX_RESEARCH_HISTORY ||
    !history.every(isHistoryEntry)
  ) {
    return { ok: false, message: "The research history is malformed." };
  }
  return { ok: true, value: value as unknown as DeepResearchSection };
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
  };
  return {
    schema: DEEP_RESEARCH_SCHEMA,
    active: null,
    history: [entry, ...history].slice(0, MAX_RESEARCH_HISTORY),
  };
}

function isResearchState(value: unknown): value is ResearchState {
  if (!isRecord(value)) return false;
  return (
    value.schema === DEEP_RESEARCH_SCHEMA &&
    isResearchId(value.researchId) &&
    isRevision(value.revision) &&
    isText(value.question, MAX_QUESTION) &&
    PHASES.includes(value.phase as ResearchPhase) &&
    !isTerminalResearchPhase(value.phase as ResearchPhase) &&
    (value.pending === null || isPending(value.pending)) &&
    (value.plan === null || isPlan(value.plan)) &&
    (value.terminalReason === null || isText(value.terminalReason, MAX_QUESTION)) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isPending(value: unknown): value is PendingDecision {
  return (
    isRecord(value) &&
    isResearchId(value.decisionId) &&
    DECISION_KINDS.includes(value.kind as string) &&
    isRevision(value.artifactRevision)
  );
}

function isPlan(value: unknown): value is ResearchPlan {
  if (!isRecord(value)) return false;
  const shaped =
    isResearchId(value.planId) &&
    isRevision(value.revision) &&
    isTextList(value.objectives) &&
    isTextList(value.reportOutline) &&
    isTextList(value.knownOmissions) &&
    Array.isArray(value.branches) &&
    value.branches.every(isBranch) &&
    PRESETS.includes(value.preset as string) &&
    isRecord(value.limits) &&
    Object.values(value.limits).every(isRevision) &&
    isRevision(value.generationsUsed) &&
    (value.approvedAt === null || typeof value.approvedAt === "string");
  return shaped && validatePlan(value as unknown as ResearchPlan) === null;
}

function isBranch(value: unknown): value is ResearchBranch {
  return (
    isRecord(value) &&
    isResearchId(value.branchId) &&
    isText(value.title, MAX_QUESTION) &&
    isText(value.task, MAX_QUESTION) &&
    isText(value.expectedOutput, MAX_QUESTION) &&
    (value.priority === "required" || value.priority === "optional") &&
    typeof value.enabled === "boolean" &&
    isTextList(value.objectives) &&
    SCOPES.includes(value.sourceScope as string) &&
    Array.isArray(value.dependsOn) &&
    value.dependsOn.every(isResearchId)
  );
}

function isHistoryEntry(value: unknown): value is ResearchHistoryEntry {
  return (
    isRecord(value) &&
    isResearchId(value.researchId) &&
    isText(value.question, MAX_QUESTION) &&
    PHASES.includes(value.phase as ResearchPhase) &&
    (value.terminalReason === null || isText(value.terminalReason, MAX_QUESTION)) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isText(entry, MAX_QUESTION));
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
