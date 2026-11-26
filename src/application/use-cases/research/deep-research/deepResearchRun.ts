import type { ResearchStreamEvent } from "@application/contracts/research";
import type { ResearchStatePort } from "@application/ports/researchState";
import type { ResearchAnswer } from "@core/answer";
import { formatCitation } from "@core/retrieval";
import { label, researchLanguageOf, type ResearchState } from "@core/research/deepResearch";
import type {
  ResearchExecutionContext,
  ResearchStrategyOutcome,
} from "../strategies/ResearchStrategy";
import type { DeepResearchStrategyDeps } from "./DeepResearchStrategy";
import { MainBranchRunner } from "./MainBranchRunner";
import { SubAgentBranchRunner } from "./SubAgentBranchRunner";
import { ReportSynthesisService } from "./ReportSynthesisService";
import { ResearchDiscoveryService } from "./ResearchDiscoveryService";
import { pumpEvents } from "./eventPump";
import { runResearch, type ResearchRunResult, type SuppliedObservation } from "./researchRun";
import { defaultTimer, referenceEvent } from "./strategyHelpers";
import { preflightScope } from "./deepResearchTurns";
import { turnRecorderOf } from "./DeepResearchTurnRecorder";

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
  const labels = deps.researchLabels.labelsFor(researchLanguageOf(approved));
  const result = yield* pumpEvents<ResearchStreamEvent, ResearchRunResult>((push) => {
    const recorder = turnRecorderOf(ctx);
    const mainRunner = new MainBranchRunner({
      engine: deps.createBranchEngine(),
      sources: deps.branchSources,
      web: ctx.retrieval.web,
      chatScope: scope,
      branches: approved.plan!.branches,
      ...(ctx.request.finalizeAnswer ? { registerAnswer: ctx.request.finalizeAnswer } : {}),
      onEvent: push,
      now: deps.now,
    });
    const runner = recorder?.observeRunner(mainRunner) ?? mainRunner;
    const delegated = ctx.request.subAgentResearch;
    const parent = ctx.request.subAgentParent;
    return runResearch(approved, {
      port,
      runner,
      ...(delegated && parent
        ? {
            subAgents: {
              attach: (permits) => delegated.attachBudget(permits),
              createRunner: (sessionOf) => {
                const subAgent = new SubAgentBranchRunner({
                  branches: approved.plan!.branches,
                  delegator: (branch, allocation) => delegated.delegator(branch, allocation),
                  resolver: parent.resolver,
                  sessionOf,
                  ...(parent.listSessions ? { listSessions: parent.listSessions } : {}),
                });
                return recorder?.observeRunner(subAgent) ?? subAgent;
              },
            },
          }
        : {}),
      parallelRequests: deps.toolCapabilities.parallelCalls,
      labels,
      synthesis: new ReportSynthesisService({
        chatModel: deps.chatModel,
        model: deps.chatModelName,
        chatOptions: deps.chatOptions,
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
        finalAnswer = withEvidenceCitations(ctx.request.finalizeAnswer?.(answer) ?? answer);
        return finalAnswer.answer;
      },
      now: deps.now,
      setTimer: deps.setTimer ?? defaultTimer,
      createId: createId,
      onState: (state) => push(referenceEvent(state)),
      onStatus: (message) => push({ type: "status", message }),
      onActivity: (activity) => {
        deps.onStage?.(activity.stage);
        push({ type: "research-activity", activity });
      },
    });
  });
  if (result.state.pending?.kind === "stale-plan") {
    return yield* finish(ctx, result.state, labels.turnObservationStale);
  }
  if (result.state.phase === "awaiting-observation") {
    const test = result.state.discovery!.tests.find(
      (entry) => entry.testId === result.state.pending?.subjectId,
    )!;
    return yield* finish(
      ctx,
      result.state,
      label(labels, "turnNeedsObservation", { method: test.method }),
    );
  }
  if (!result.report) {
    return yield* finish(
      ctx,
      result.state,
      label(labels, "turnFailed", { reason: result.state.terminalReason ?? "" }),
    );
  }
  return yield* finish(ctx, result.state, result.report.markdown, finalAnswer ?? undefined);
}

/** Cites every source the finalized report resolved, so its tokens render as citations. */
function withEvidenceCitations(answer: ResearchAnswer): ResearchAnswer {
  const evidence = answer.evidence ?? [];
  return {
    ...answer,
    citations: evidence.map((chunk) => ({ ...formatCitation(chunk.source), id: chunk.id })),
  };
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
