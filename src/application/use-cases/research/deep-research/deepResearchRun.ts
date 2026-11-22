import type { ResearchStreamEvent } from "@application/contracts/research";
import type { ResearchStatePort } from "@application/ports/researchState";
import type { ResearchAnswer } from "@core/answer";
import type { ResearchState } from "@core/research/deepResearch";
import type {
  ResearchExecutionContext,
  ResearchStrategyOutcome,
} from "../strategies/ResearchStrategy";
import type { DeepResearchStrategyDeps } from "./DeepResearchStrategy";
import { MainBranchRunner } from "./MainBranchRunner";
import { SubAgentBranchRunner } from "./SubAgentBranchRunner";
import { ReportSynthesisService } from "./ReportSynthesisService";
import { EvidenceVerificationService } from "./EvidenceVerificationService";
import { ResearchDiscoveryService } from "./ResearchDiscoveryService";
import { pumpEvents } from "./eventPump";
import { runResearch, type ResearchRunResult, type SuppliedObservation } from "./researchRun";
import { defaultTimer, referenceEvent } from "./strategyHelpers";
import { preflightScope } from "./deepResearchTurns";

export type TurnEvents = AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome>;

/**
 * Runs an approved research within one turn with the branch runners of the chat, the evidence
 * verifier and the report synthesis, forwarding progress events and ending with the report or the
 * failure of the research.
 */
export async function* runApprovedTurn(
  deps: DeepResearchStrategyDeps,
  ctx: ResearchExecutionContext,
  port: ResearchStatePort,
  approved: ResearchState,
  createId: (prefix: string) => string,
  observation?: SuppliedObservation,
): TurnEvents {
  const scope = preflightScope(ctx.searchMode, sourcesOf(deps));
  const signal = ctx.request.signal;
  let finalAnswer: ResearchAnswer | null = null;
  const result = yield* pumpEvents<ResearchStreamEvent, ResearchRunResult>((push) => {
    const runner = new MainBranchRunner({
      engine: deps.createBranchEngine(),
      sources: deps.branchSources,
      web: ctx.retrieval.web,
      chatScope: scope,
      branches: approved.plan!.branches,
      ...(ctx.request.finalizeAnswer ? { registerAnswer: ctx.request.finalizeAnswer } : {}),
      onEvent: push,
      now: deps.now,
    });
    const delegated = ctx.request.subAgentResearch;
    const parent = ctx.request.subAgentParent;
    return runResearch(approved, {
      port,
      runner,
      ...(delegated && parent
        ? {
            subAgents: {
              attach: (permits) => delegated.attachBudget(permits),
              createRunner: (sessionOf) =>
                new SubAgentBranchRunner({
                  branches: approved.plan!.branches,
                  delegator: (branch, allocation) => delegated.delegator(branch, allocation),
                  resolver: parent.resolver,
                  sessionOf,
                  ...(parent.listSessions ? { listSessions: parent.listSessions } : {}),
                }),
            },
          }
        : {}),
      parallelRequests: deps.toolCapabilities.parallelCalls,
      synthesis: new ReportSynthesisService({
        chatModel: deps.chatModel,
        model: deps.chatModelName,
        chatOptions: deps.chatOptions,
      }),
      createVerifier: (options) =>
        new EvidenceVerificationService({
          chatModel: deps.chatModel,
          model: deps.chatModelName,
          chatOptions: deps.chatOptions,
          ...options,
        }),
      createDiscovery: (options) =>
        new ResearchDiscoveryService({
          chatModel: deps.chatModel,
          model: deps.chatModelName,
          chatOptions: deps.chatOptions,
          createId,
          now: () => deps.now().toISOString(),
          ...options,
        }),
      ...(observation ? { observation } : {}),
      ...(signal ? { signal } : {}),
      ...(ctx.request.resolveEvidence ? { resolveEvidence: ctx.request.resolveEvidence } : {}),
      finalizeReport: (markdown) => {
        const answer: ResearchAnswer = {
          question: approved.question,
          answer: markdown,
          citations: [],
          evidence: [],
          followUpQuestions: [],
          createdAt: deps.now().toISOString(),
        };
        finalAnswer = ctx.request.finalizeAnswer?.(answer) ?? answer;
        return finalAnswer.answer;
      },
      now: deps.now,
      setTimer: deps.setTimer ?? defaultTimer,
      createId: createId,
      onState: (state) => push(referenceEvent(state)),
      onStatus: (message) => push({ type: "status", message }),
    });
  });
  if (result.state.pending?.kind === "stale-plan") {
    return yield* finish(
      ctx,
      result.state,
      "Observation recorded. The approved plan is old; continue anyway, replan or cancel the research.",
    );
  }
  if (result.state.phase === "awaiting-observation") {
    const test = result.state.discovery!.tests.find((entry) => entry.status === "awaiting-input")!;
    return yield* finish(
      ctx,
      result.state,
      `The research needs an observation you supply: ${test.method}`,
    );
  }
  if (!result.report) {
    return yield* finish(ctx, result.state, `Research failed: ${result.state.terminalReason}`);
  }
  return yield* finish(ctx, result.state, result.report.markdown, finalAnswer ?? undefined);
}

function sourcesOf(deps: DeepResearchStrategyDeps) {
  return {
    toolCalls: deps.toolCapabilities.calls,
    index: deps.hasIndex,
    web: deps.hasWeb,
  };
}

/** Ends a research turn with its reference event and the turn's answer text. */
export async function* finish(
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
