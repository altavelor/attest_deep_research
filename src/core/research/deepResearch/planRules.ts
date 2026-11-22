import { DEEP_RESEARCH_SCHEMA, MAX_PLAN_GENERATIONS, MAX_RESEARCH_TEXT_CHARS } from "./limits";
import { boundedReason } from "./rejection";
import { validatePlan } from "./planValidation";
import { initialExecutions } from "./schedule";
import type {
  PlanBranchEdit,
  PlanDecisionPayload,
  PlanEdit,
  ResearchDecision,
  ResearchPlan,
  ResearchState,
} from "./types";

export type ResearchRuleCode =
  | "research-stale-decision"
  | "research-invalid-decision"
  | "research-generation-limit"
  | "research-invalid-plan";

export type ResearchTransition =
  { ok: true; state: ResearchState } | { ok: false; code: ResearchRuleCode; message: string };

export interface DecisionContext {
  now: string;
  nextDecisionId: string;
  regenerated?: ResearchPlan | null;
}

const MAX_EDIT_TEXT = MAX_RESEARCH_TEXT_CHARS;

/** Creates the planning state of a new research before its first plan generation. */
export function startResearchState(
  researchId: string,
  question: string,
  now: string,
): ResearchState {
  return {
    schema: DEEP_RESEARCH_SCHEMA,
    researchId,
    revision: 1,
    question,
    phase: "planning",
    pending: null,
    plan: null,
    terminalReason: null,
    createdAt: now,
    updatedAt: now,
    budget: null,
    executions: [],
    sessionByBranch: {},
    report: null,
    brief: null,
    verification: null,
  };
}

/** Puts a generated plan up for review with a fresh pending plan decision. */
export function withPlanForReview(
  state: ResearchState,
  plan: ResearchPlan,
  decisionId: string,
  now: string,
): ResearchState {
  return {
    ...state,
    revision: state.revision + 1,
    phase: "awaiting-approval",
    plan,
    pending: { decisionId, kind: "plan", artifactRevision: plan.revision },
    updatedAt: now,
  };
}

/** Ends a research with a terminal phase and reason; the pending decision is dropped. */
export function endResearch(
  state: ResearchState,
  phase: "failed" | "cancelled",
  reason: string,
  now: string,
): ResearchState {
  return {
    ...state,
    revision: state.revision + 1,
    phase,
    pending: null,
    terminalReason: boundedReason(reason),
    updatedAt: now,
  };
}

/** Tells whether one more plan generation is allowed. */
export function canRegenerate(plan: ResearchPlan): boolean {
  return plan.generationsUsed < MAX_PLAN_GENERATIONS;
}

/** Checks that a decision answers the pending decision of this exact state revision. */
export function decisionMismatch(state: ResearchState, decision: ResearchDecision): string | null {
  const pending = state.pending;
  if (
    !pending ||
    decision.researchId !== state.researchId ||
    decision.decisionId !== pending.decisionId ||
    decision.expectedRevision !== state.revision
  ) {
    return "This decision no longer matches the research; review the current plan.";
  }
  return null;
}

/**
 * Applies a plan decision to a research state. Approval sets `approvedAt` and clears the
 * pending decision, an edit creates a new validated plan revision, and a regeneration takes
 * the regenerated plan or, when the generation failed, only consumes one generation.
 */
export function applyDecision(
  state: ResearchState,
  decision: ResearchDecision,
  context: DecisionContext,
): ResearchTransition {
  const mismatch = decisionMismatch(state, decision);
  if (mismatch) return { ok: false, code: "research-stale-decision", message: mismatch };
  const payload = parsePlanDecisionPayload(decision.payload);
  const plan = state.plan;
  if (!payload || !plan || state.pending?.kind !== "plan") {
    return { ok: false, code: "research-invalid-decision", message: "The decision is malformed." };
  }
  if (payload.action === "approve") {
    return {
      ok: true,
      state: {
        ...state,
        revision: state.revision + 1,
        phase: "gathering",
        pending: null,
        plan: { ...plan, approvedAt: context.now },
        executions: initialExecutions(plan),
        updatedAt: context.now,
      },
    };
  }
  if (payload.action === "edit") {
    const edited = applyPlanEdit(plan, payload.edit);
    if (!edited.ok) return edited;
    return {
      ok: true,
      state: withPlanForReview(state, edited.plan, context.nextDecisionId, context.now),
    };
  }
  if (!canRegenerate(plan)) {
    return {
      ok: false,
      code: "research-generation-limit",
      message: "All plan generations are used; edit the plan manually.",
    };
  }
  const consumed = plan.generationsUsed + 1;
  const next = context.regenerated
    ? { ...context.regenerated, planId: plan.planId, revision: plan.revision + 1 }
    : plan;
  return {
    ok: true,
    state: withPlanForReview(
      state,
      { ...next, generationsUsed: consumed },
      context.nextDecisionId,
      context.now,
    ),
  };
}

/** Applies a manual edit to a plan, producing a new validated revision without a model call. */
export function applyPlanEdit(
  plan: ResearchPlan,
  edit: PlanEdit,
):
  { ok: true; plan: ResearchPlan } | { ok: false; code: "research-invalid-plan"; message: string } {
  const edits = new Map((edit.branches ?? []).map((entry) => [entry.branchId, entry]));
  const unknown = [...edits.keys()].some((id) => !plan.branches.some((b) => b.branchId === id));
  if (unknown)
    return {
      ok: false,
      code: "research-invalid-plan",
      message: "The edit names an unknown branch.",
    };
  const next: ResearchPlan = {
    ...plan,
    revision: plan.revision + 1,
    branches: plan.branches.map((branch) => {
      const change = edits.get(branch.branchId);
      return change
        ? {
            ...branch,
            ...(change.title !== undefined ? { title: change.title } : {}),
            ...(change.task !== undefined ? { task: change.task } : {}),
            ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
          }
        : branch;
    }),
    knownOmissions: edit.knownOmissions ?? plan.knownOmissions,
  };
  const problem = validatePlan(next);
  return problem
    ? { ok: false, code: "research-invalid-plan", message: problem }
    : { ok: true, plan: next };
}

/** Reads an untrusted plan decision payload, or returns null when it is malformed. */
export function parsePlanDecisionPayload(value: unknown): PlanDecisionPayload | null {
  if (!isRecord(value)) return null;
  if (value.action === "approve") return { action: "approve" };
  if (value.action === "regenerate") {
    const instruction = value.instruction;
    if (instruction === null) return { action: "regenerate", instruction: null };
    return boundedText(instruction) ? { action: "regenerate", instruction } : null;
  }
  if (value.action !== "edit" || !isRecord(value.edit)) return null;
  const { branches, knownOmissions } = value.edit;
  const parsedBranches = branches === undefined ? [] : parseBranchEdits(branches);
  const omissionsValid =
    knownOmissions === undefined ||
    (Array.isArray(knownOmissions) && knownOmissions.every(boundedText));
  if (!parsedBranches || !omissionsValid) return null;
  return {
    action: "edit",
    edit: {
      branches: parsedBranches,
      ...(knownOmissions !== undefined ? { knownOmissions: knownOmissions as string[] } : {}),
    },
  };
}

function parseBranchEdits(value: unknown): PlanBranchEdit[] | null {
  if (!Array.isArray(value)) return null;
  const edits: PlanBranchEdit[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.branchId !== "string") return null;
    const { title, task, enabled } = entry;
    if (title !== undefined && !boundedText(title)) return null;
    if (task !== undefined && !boundedText(task)) return null;
    if (enabled !== undefined && typeof enabled !== "boolean") return null;
    edits.push({
      branchId: entry.branchId,
      ...(title !== undefined ? { title: title as string } : {}),
      ...(task !== undefined ? { task: task as string } : {}),
      ...(enabled !== undefined ? { enabled: enabled as boolean } : {}),
    });
  }
  return edits;
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_EDIT_TEXT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
