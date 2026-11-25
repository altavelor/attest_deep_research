import { DEEP_RESEARCH_SCHEMA, MAX_PLAN_GENERATIONS, MAX_RESEARCH_TEXT_CHARS } from "./limits";
import { boundedReason } from "./rejection";
import { applyPlanEdit, parsePlanEdit } from "./planEdit";
import { initialExecutions } from "./schedule";
import type { PlanDecisionPayload, ResearchDecision, ResearchPlan, ResearchState } from "./types";

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
    discovery: null,
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
  const edit = parsePlanEdit(value.edit);
  return edit ? { action: "edit", edit } : null;
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_EDIT_TEXT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
