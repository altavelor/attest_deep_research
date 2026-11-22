import type { ChatModelProvider, ChatRequest, ToolCallingCapabilities } from "@core/agent";
import type { ResearchStatePort } from "@application/ports/researchState";
import type { ResearchStreamEvent } from "@application/contracts/research";
import type { SubAgentPort } from "@application/research/subAgentPort";
import type { SubAgentToolSources } from "../sub-agent/subAgentToolContext";
import {
  DEFAULT_RESEARCH_PRESET,
  MAX_PLAN_GENERATIONS,
  applyDecision,
  canRegenerate,
  parseStalePlanPayload,
  decisionMismatch,
  deepResearchRejected,
  endResearch,
  isPlanStale,
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
import type { ResearchAnswer } from "@core/answer";
import { ResearchPlanService } from "./ResearchPlanService";
import { MainBranchRunner } from "./MainBranchRunner";
import { ReportSynthesisService } from "./ReportSynthesisService";
import { pumpEvents } from "./eventPump";
import { runResearch, type ResearchRunResult } from "./researchRun";
import {
  defaultTimer,
  isAbort,
  isExecuting,
  referenceEvent,
  reopenedBudget,
  stale,
} from "./strategyHelpers";
import {
  abandonsPlanning,
  checkTurnText,
  preflightScope,
  resolveResearchTurn,
  type ResearchSources,
} from "./deepResearchTurns";

export interface DeepResearchStrategyDeps {
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  toolCapabilities: ToolCallingCapabilities;
  hasIndex: boolean;
  hasWeb: boolean;
  now(): Date;
  createId?(): string;
  createBranchEngine(): SubAgentPort;
  branchSources: SubAgentToolSources;
  setTimer?(delayMs: number, callback: () => void): () => void;
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
    let active = view.active;
    if (active && abandonsPlanning(ctx.request.research, active)) {
      const reason = "Interrupted during planning.";
      await port.commit(endResearch(active, "failed", reason, this.now()), active.revision);
      active = null;
    }
    const turn = resolveResearchTurn(ctx.request.research, active, ctx.question);
    checkTurnText(turn, ctx.question);
    if (turn.type === "start") return yield* this.start(ctx, port);
    if (turn.type === "decision") {
      if (!active) throw stale();
      return yield* this.decide(ctx, port, active, turn.decision);
    }
    if (!active || active.researchId !== turn.researchId) throw stale();
    if (turn.type === "continue") return yield* this.resume(ctx, port, active);
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
      const ended = isAbort(error)
        ? endResearch(planning, "cancelled", "Stopped while drafting the plan.", this.now())
        : endResearch(
            planning,
            "failed",
            error instanceof Error ? error.message : "The plan could not be generated.",
            this.now(),
          );
      await port.commit(ended, planning.revision).catch(() => undefined);
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
    if (active.pending?.kind === "stale-plan") {
      return yield* this.decideStale(ctx, port, active, decision);
    }
    const context = { now: this.now(), nextDecisionId: this.createId("decision") };
    const consumed = applyDecision(active, decision, { ...context, regenerated: null });
    if (!consumed.ok) throw deepResearchRejected(consumed.code, consumed.message);
    const payload = parsePlanDecisionPayload(decision.payload)!;
    if (payload.action !== "regenerate") {
      await port.commit(consumed.state, active.revision);
      if (payload.action === "approve") return yield* this.run(ctx, port, consumed.state);
      return yield* finish(
        ctx,
        consumed.state,
        `Plan updated to revision ${consumed.state.plan!.revision}.`,
      );
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

  private async *resume(
    ctx: ResearchExecutionContext,
    port: ResearchStatePort,
    active: ResearchState,
  ): TurnEvents {
    if (!isExecuting(active) || active.pending !== null) {
      throw deepResearchRejected(
        "research-continue-unavailable",
        "This research is not paused; answer its pending decision or cancel it.",
      );
    }
    if (isPlanStale(active.plan!, this.now())) {
      const asked: ResearchState = {
        ...active,
        revision: active.revision + 1,
        pending: {
          decisionId: this.createId("decision"),
          kind: "stale-plan",
          artifactRevision: active.plan!.revision,
        },
        updatedAt: this.now(),
      };
      await port.commit(asked, active.revision);
      return yield* finish(
        ctx,
        asked,
        "The approved plan is old; continue anyway, replan or cancel the research.",
      );
    }
    return yield* this.run(ctx, port, active);
  }

  private async *decideStale(
    ctx: ResearchExecutionContext,
    port: ResearchStatePort,
    active: ResearchState,
    decision: ResearchDecision,
  ): TurnEvents {
    const action = parseStalePlanPayload(decision.payload);
    if (action === null) {
      throw deepResearchRejected("research-invalid-decision", "The decision is malformed.");
    }
    if (action === "cancel") {
      const cancelled = endResearch(active, "cancelled", "Cancelled by the user.", this.now());
      await port.commit(cancelled, active.revision);
      return yield* finish(ctx, cancelled, "Research cancelled.");
    }
    if (action === "continue") {
      const resumed = {
        ...active,
        revision: active.revision + 1,
        pending: null,
        updatedAt: this.now(),
      };
      await port.commit(resumed, active.revision);
      return yield* this.run(ctx, port, resumed);
    }
    const plan = active.plan!;
    if (!canRegenerate(plan)) {
      throw deepResearchRejected(
        "research-generation-limit",
        "No plan generations remain; continue the old plan or cancel the research.",
      );
    }
    if (active.budget?.closed) {
      throw deepResearchRejected(
        "research-generation-limit",
        "The research budget is closed, so a new plan could not run; continue or cancel instead.",
      );
    }
    const scope = preflightScope(ctx.searchMode, this.sources());
    yield { type: "status", message: "Regenerating the research plan…" };
    const regenerated = await this.planService(ctx, scope, plan.generationsUsed + 1).generate(
      active.question,
      null,
    );
    const review = withPlanForReview(
      { ...active, executions: [], budget: reopenedBudget(active, this.deps.now) },
      { ...regenerated, revision: plan.revision + 1 },
      this.createId("decision"),
      this.now(),
    );
    await port.commit(review, active.revision);
    return yield* finish(ctx, review, "A new plan is ready for review.");
  }

  private async *run(
    ctx: ResearchExecutionContext,
    port: ResearchStatePort,
    approved: ResearchState,
  ): TurnEvents {
    const scope = preflightScope(ctx.searchMode, this.sources());
    const signal = ctx.request.signal;
    let finalAnswer: ResearchAnswer | null = null;
    const result = yield* pumpEvents<ResearchStreamEvent, ResearchRunResult>((push) => {
      const runner = new MainBranchRunner({
        engine: this.deps.createBranchEngine(),
        sources: this.deps.branchSources,
        web: ctx.retrieval.web,
        chatScope: scope,
        branches: approved.plan!.branches,
        ...(ctx.request.finalizeAnswer ? { registerAnswer: ctx.request.finalizeAnswer } : {}),
        onEvent: push,
        now: this.deps.now,
      });
      return runResearch(approved, {
        port,
        runner,
        synthesis: new ReportSynthesisService({
          chatModel: this.deps.chatModel,
          model: this.deps.chatModelName,
          chatOptions: this.deps.chatOptions,
        }),
        ...(signal ? { signal } : {}),
        ...(ctx.request.resolveEvidence ? { resolveEvidence: ctx.request.resolveEvidence } : {}),
        finalizeReport: (markdown) => {
          const answer: ResearchAnswer = {
            question: approved.question,
            answer: markdown,
            citations: [],
            evidence: [],
            followUpQuestions: [],
            createdAt: this.now(),
          };
          finalAnswer = ctx.request.finalizeAnswer?.(answer) ?? answer;
          return finalAnswer.answer;
        },
        now: this.deps.now,
        setTimer: this.deps.setTimer ?? defaultTimer,
        createId: (prefix) => this.createId(prefix),
        onState: (state) => push(referenceEvent(state)),
        onStatus: (message) => push({ type: "status", message }),
      });
    });
    if (!result.report) {
      return yield* finish(ctx, result.state, `Research failed: ${result.state.terminalReason}`);
    }
    return yield* finish(ctx, result.state, result.report.markdown, finalAnswer ?? undefined);
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
  report?: ResearchAnswer,
): TurnEvents {
  const answer = report ?? {
    question: ctx.question,
    answer: text,
    citations: [],
    followUpQuestions: [],
    createdAt: state.updatedAt,
  };
  yield referenceEvent(state);
  yield { type: "delta", content: answer.answer };
  yield { type: "complete", answer };
  return { kind: "completed" };
}
