import type { ResearchStatePort } from "@application/ports/researchState";
import {
  answeredBrief,
  deepResearchRejected,
  endResearch,
  parseClarificationPayload,
  readyBrief,
  startResearchState,
  withClarificationQuestions,
  withPlanForReview,
  type ResearchBrief,
  type ResearchDecision,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchExecutionContext } from "../strategies/ResearchStrategy";
import type { ResearchPlanService } from "./ResearchPlanService";
import type { ResearchClarificationService } from "./ResearchClarificationService";
import { finish, type TurnEvents } from "./deepResearchRun";
import { isAbort } from "./strategyHelpers";

export interface PlanningTurnContext {
  ctx: ResearchExecutionContext;
  port: ResearchStatePort;
  now(): string;
  createId(prefix: string): string;
  planService(generationsUsed: number, brief: ResearchBrief | null): ResearchPlanService;
  clarification(): ResearchClarificationService;
}

/**
 * Starts a research: one clarification call decides between questions, which end the turn with a
 * pending clarification decision, and a ready brief, which goes straight to planning. A failed or
 * malformed clarification counts as one plan generation; a successful one does not.
 */
export async function* startTurn(turn: PlanningTurnContext): TurnEvents {
  const { ctx, port } = turn;
  const planning = startResearchState(turn.createId("research"), ctx.question, turn.now());
  await port.commit(planning, null);
  yield { type: "status", message: "Checking whether the question needs clarification…" };
  let outcome;
  try {
    outcome = await turn.clarification().decide(ctx.question);
  } catch (error) {
    await endPlanning(turn, planning, error);
    throw error;
  }
  if (outcome.kind === "questions") {
    const asked = withClarificationQuestions(
      planning,
      outcome,
      turn.createId("decision"),
      turn.now(),
    );
    await port.commit(asked, planning.revision);
    return yield* finish(
      ctx,
      asked,
      `The research needs clarification: ${outcome.questions.length} question(s).`,
    );
  }
  const briefed = { ...planning, brief: readyBrief(outcome.assumptions) };
  return yield* draftPlan(turn, briefed, planning.revision, outcome.failed ? 2 : 1);
}

/**
 * Applies the answer to the pending clarification: card answers may address only the recorded
 * questions, plain text becomes a clarification of the user, and continuing keeps the assumptions.
 * The brief is recorded and planning follows in the same turn.
 */
export async function* clarificationTurn(
  turn: PlanningTurnContext,
  active: ResearchState,
  decision: ResearchDecision,
): TurnEvents {
  const payload = parseClarificationPayload(decision.payload);
  const brief = payload && active.brief ? answeredBrief(active.brief, payload) : null;
  if (!brief) {
    throw deepResearchRejected(
      "research-invalid-decision",
      "The clarification answers a question that was not asked.",
    );
  }
  const planning: ResearchState = {
    ...active,
    revision: active.revision + 1,
    phase: "planning",
    pending: null,
    brief,
    updatedAt: turn.now(),
  };
  await turn.port.commit(planning, active.revision);
  return yield* draftPlan(turn, planning, planning.revision, 1);
}

async function* draftPlan(
  turn: PlanningTurnContext,
  planning: ResearchState,
  committedRevision: number,
  generationsUsed: number,
): TurnEvents {
  yield { type: "status", message: "Drafting a research plan…" };
  try {
    const plan = await turn
      .planService(generationsUsed, planning.brief)
      .generate(planning.question, null);
    const review = withPlanForReview(
      { ...planning, revision: committedRevision },
      plan,
      turn.createId("decision"),
      turn.now(),
    );
    await turn.port.commit(review, committedRevision);
    return yield* finish(
      turn.ctx,
      review,
      `Research plan ready for review: ${plan.branches.length} branches.`,
    );
  } catch (error) {
    await endPlanning(turn, { ...planning, revision: committedRevision }, error);
    throw error;
  }
}

async function endPlanning(
  turn: PlanningTurnContext,
  planning: ResearchState,
  error: unknown,
): Promise<void> {
  const ended = isAbort(error)
    ? endResearch(planning, "cancelled", "Stopped while drafting the plan.", turn.now())
    : endResearch(
        planning,
        "failed",
        error instanceof Error ? error.message : "The plan could not be generated.",
        turn.now(),
      );
  await turn.port.commit(ended, planning.revision).catch(() => undefined);
}
