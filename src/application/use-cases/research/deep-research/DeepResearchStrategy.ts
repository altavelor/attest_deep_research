import type { ChatModelProvider, ChatRequest, ToolCallingCapabilities } from "@core/agent";
import type { ResearchStatePort } from "@application/ports/researchState";
import type { ResearchStreamEvent } from "@application/contracts/research";
import {
  DEFAULT_RESEARCH_PRESET,
  MAX_PLAN_GENERATIONS,
  applyDecision,
  decisionMismatch,
  deepResearchRejected,
  endResearch,
  parsePlanDecisionPayload,
  startResearchState,
  withPlanForReview,
  type ResearchDecision,
  type ResearchState,
} from "@core/research/deepResearch";
import type {
  ResearchExecutionContext,
  ResearchStrategy,
  ResearchStrategyOutcome,
} from "../strategies/ResearchStrategy";
import { ResearchPlanService } from "./ResearchPlanService";
import { preflightScope, resolveResearchTurn, type ResearchSources } from "./deepResearchTurns";

export interface DeepResearchStrategyDeps {
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  toolCapabilities: ToolCallingCapabilities;
  hasIndex: boolean;
  hasWeb: boolean;
  now(): Date;
  createId?(): string;
}

type TurnEvents = AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome>;

/**
 * Runs one turn of a Deep Research that spans several ordinary chat turns: start a research and
 * put its plan up for review, apply a plan decision, or cancel. Every state change is committed
 * through the research state port with the expected revision before the turn completes.
 */
export class DeepResearchStrategy implements ResearchStrategy {
  constructor(private readonly deps: DeepResearchStrategyDeps) {}

  async *execute(ctx: ResearchExecutionContext): TurnEvents {
    const port = ctx.request.researchState;
    if (!port) {
      throw deepResearchRejected("research-state-unreadable", "Deep Research needs a saved chat.");
    }
    const view = port.read();
    if (view.status === "unreadable") {
      throw deepResearchRejected(
        "research-state-unreadable",
        `The saved research state of this chat is unreadable: ${view.reason}`,
      );
    }
    const turn = resolveResearchTurn(ctx.request.research, view.active, ctx.question);
    if (turn.type === "start") return yield* this.start(ctx, port);
    const active = view.active;
    if (turn.type === "decision") {
      if (!active) throw stale();
      return yield* this.decide(ctx, port, active, turn.decision);
    }
    if (!active || active.researchId !== turn.researchId) throw stale();
    if (turn.type === "continue") {
      throw deepResearchRejected(
        "research-continue-unavailable",
        "Continuing an approved research is not available yet.",
      );
    }
    const cancelled = endResearch(active, "cancelled", "Cancelled by the user.", this.now());
    await port.commit(cancelled, active.revision);
    return yield* finish(ctx, cancelled, "Research cancelled.");
  }

  private async *start(ctx: ResearchExecutionContext, port: ResearchStatePort): TurnEvents {
    const scope = preflightScope(ctx.searchMode, this.sources());
    const planning = startResearchState(this.createId("research"), ctx.question, this.now());
    await port.commit(planning, null);
    yield { type: "status", message: "Drafting a research plan…" };
    try {
      const plan = await this.planService(ctx, scope, 1).generate(ctx.question, null);
      const review = withPlanForReview(planning, plan, this.createId("decision"), this.now());
      await port.commit(review, planning.revision);
      return yield* finish(
        ctx,
        review,
        `Research plan ready for review: ${plan.branches.length} branches.`,
      );
    } catch (error) {
      if (isAbort(error)) throw error;
      const reason = error instanceof Error ? error.message : "The plan could not be generated.";
      await port.commit(endResearch(planning, "failed", reason, this.now()), planning.revision);
      throw error;
    }
  }

  private async *decide(
    ctx: ResearchExecutionContext,
    port: ResearchStatePort,
    active: ResearchState,
    decision: ResearchDecision,
  ): TurnEvents {
    if (decisionMismatch(active, decision)) throw stale();
    const context = { now: this.now(), nextDecisionId: this.createId("decision") };
    const consumed = applyDecision(active, decision, { ...context, regenerated: null });
    if (!consumed.ok) throw deepResearchRejected(consumed.code, consumed.message);
    const payload = parsePlanDecisionPayload(decision.payload)!;
    if (payload.action !== "regenerate") {
      await port.commit(consumed.state, active.revision);
      const text =
        payload.action === "approve"
          ? "Plan approved. Running the research is not available yet in this preview."
          : `Plan updated to revision ${consumed.state.plan!.revision}.`;
      return yield* finish(ctx, consumed.state, text);
    }
    const scope = preflightScope(ctx.searchMode, this.sources());
    yield { type: "status", message: "Regenerating the research plan…" };
    const used = consumed.state.plan!.generationsUsed;
    let regenerated;
    try {
      regenerated = await this.planService(ctx, scope, used).generate(
        active.question,
        payload.instruction,
      );
    } catch (error) {
      if (!isAbort(error)) await port.commit(consumed.state, active.revision);
      throw error;
    }
    const next = applyDecision(active, decision, { ...context, regenerated });
    if (!next.ok) throw deepResearchRejected(next.code, next.message);
    await port.commit(next.state, active.revision);
    return yield* finish(
      ctx,
      next.state,
      `Plan regenerated (generation ${used} of ${MAX_PLAN_GENERATIONS}).`,
    );
  }

  private planService(
    ctx: ResearchExecutionContext,
    scope: ReturnType<typeof preflightScope>,
    generationsUsed: number,
  ): ResearchPlanService {
    return new ResearchPlanService({
      chatModel: this.deps.chatModel,
      model: this.deps.chatModelName,
      chatOptions: this.deps.chatOptions,
      ...(ctx.request.chatHistory ? { chatHistory: ctx.request.chatHistory } : {}),
      ...(ctx.request.signal ? { signal: ctx.request.signal } : {}),
      chatScope: scope,
      preset: DEFAULT_RESEARCH_PRESET,
      generationsUsed,
      createId: () => this.createId("plan"),
    });
  }

  private sources(): ResearchSources {
    return {
      toolCalls: this.deps.toolCapabilities.calls,
      index: this.deps.hasIndex,
      web: this.deps.hasWeb,
    };
  }

  private now(): string {
    return this.deps.now().toISOString();
  }

  private createId(prefix: string): string {
    return `${prefix}-${this.deps.createId?.() ?? globalThis.crypto.randomUUID()}`;
  }
}

async function* finish(
  ctx: ResearchExecutionContext,
  state: ResearchState,
  text: string,
): TurnEvents {
  yield {
    type: "research",
    reference: { researchId: state.researchId, artifact: "plan", revision: state.revision },
  };
  yield { type: "delta", content: text };
  yield {
    type: "complete",
    answer: {
      question: ctx.question,
      answer: text,
      citations: [],
      followUpQuestions: [],
      createdAt: state.updatedAt,
    },
  };
  return { kind: "completed" };
}

function stale(): Error {
  return deepResearchRejected(
    "research-stale-decision",
    "This decision no longer matches the research; review the current plan.",
  );
}

function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}
