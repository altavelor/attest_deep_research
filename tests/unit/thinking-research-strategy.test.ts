import { ThinkingResearchStrategy } from "@application/use-cases/research/strategies/ThinkingResearchStrategy";
import type {
  ResearchExecutionContext,
  ResearchStrategyDeps,
  ResearchStrategyOutcome,
} from "@application/use-cases/research/strategies/ResearchStrategy";
import type { ResearchStreamEvent } from "@application/contracts/research";
import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import type {
  ModelRoundProvider,
  ModelRoundRequest,
  ModelRoundResult,
  ToolCallingCapabilities,
} from "@core/agent";
import type { ResearchExecutionPolicy } from "@core/research";
import { fixedNow } from "../helpers/factories";

const CAPABILITIES: ToolCallingCapabilities = {
  calls: true,
  choiceRequired: true,
  choiceSpecific: true,
  parallelCalls: true,
};

const POLICY: ResearchExecutionPolicy = {
  strategy: "thinking",
  reason: "thinking-eligible",
  requiredTools: [],
  bootstrapChoice: { type: "auto" },
  parallelToolCalls: true,
  supportsSpecificChoice: true,
};

function emptyRetriever() {
  return { search: async () => ({ chunks: [], citations: [], usedFallback: false }) };
}

function scriptedRounds(
  handler: (request: ModelRoundRequest, index: number) => ModelRoundResult,
): ModelRoundProvider & { requests: ModelRoundRequest[] } {
  const requests: ModelRoundRequest[] = [];
  return {
    requests,
    async listModels() {
      return ["m"];
    },
    async runRound(request: ModelRoundRequest) {
      requests.push(request);
      return handler(request, requests.length);
    },
  };
}

function strategy(modelRound: ModelRoundProvider): ThinkingResearchStrategy {
  const deps = {
    chatModelName: "m",
    chatOptions: {},
    modelRound,
    modelRoundFactory: () => modelRound,
    retriever: emptyRetriever(),
    evidenceLimit: 5,
    toolsetFactory: createResearchToolRegistry,
    toolsEnabled: true,
    toolCapabilities: CAPABILITIES,
    now: fixedNow,
  } as unknown as ResearchStrategyDeps;
  return new ThinkingResearchStrategy(deps);
}

function context(
  overrides: Partial<ResearchExecutionContext["request"]> = {},
): ResearchExecutionContext {
  return {
    request: {
      question: "What is X?",
      mode: "thinking",
      searchMode: "indexOnly",
      includeContextDiagnostics: true,
      ...overrides,
    },
    question: "What is X?",
    searchMode: "indexOnly",
    policy: POLICY,
  };
}

async function drain(
  generator: AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome>,
): Promise<{ events: ResearchStreamEvent[]; outcome: ResearchStrategyOutcome }> {
  const events: ResearchStreamEvent[] = [];
  let next = await generator.next();
  while (!next.done) {
    events.push(next.value);
    next = await generator.next();
  }
  return { events, outcome: next.value };
}

describe("ThinkingResearchStrategy failure paths", () => {
  it("returns a cancelled outcome and no answer when the run is aborted mid-stream", async () => {
    const controller = new AbortController();
    const modelRound = scriptedRounds((request, index) => {
      if (index === 1) {
        request.onDelta?.({ type: "text", text: "partial answer" });
        controller.abort();
        return {
          items: [
            {
              type: "toolCall" as const,
              call: { id: "1", name: "search_index", arguments: { query: "x" } },
            },
          ],
          stopReason: "tool_calls" as const,
        };
      }
      return { items: [{ type: "text" as const, text: "late" }], stopReason: "complete" as const };
    });

    const { events, outcome } = await drain(
      strategy(modelRound).execute(context({ signal: controller.signal })),
    );

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(events.some((event) => event.type === "complete")).toBe(false);
    expect(events).toContainEqual({
      type: "checkpoint-delta",
      checkpointId: "round-1",
      round: 1,
      content: "partial answer",
    });
    expect(modelRound.requests).toHaveLength(1);
  });

  it("returns a failed outcome with an empty answer when synthesis fails", async () => {
    const modelRound = scriptedRounds(() => ({ items: [], stopReason: "error" as const }));

    const { events, outcome } = await drain(strategy(modelRound).execute(context()));

    expect(outcome).toMatchObject({
      kind: "failed",
      failure: { ok: false, reason: "provider-error" },
      answer: { answer: "", citations: [], evidence: [] },
    });
    expect(events.some((event) => event.type === "complete")).toBe(false);
    if (outcome.kind !== "failed") return;
    expect(outcome.diagnostics).toMatchObject({
      executionStrategy: "instant-fallback",
      thinking: { fallbackReason: "provider-error" },
    });
  });

  it("completes with an empty citation set when retrieval returns nothing", async () => {
    const modelRound = scriptedRounds((_request, index) =>
      index === 1
        ? {
            items: [
              {
                type: "toolCall" as const,
                call: { id: "1", name: "search_index", arguments: { query: "x" } },
              },
            ],
            stopReason: "tool_calls" as const,
          }
        : {
            items: [{ type: "text" as const, text: "No sources found." }],
            stopReason: "complete" as const,
          },
    );

    const { events, outcome } = await drain(strategy(modelRound).execute(context()));

    expect(outcome).toEqual({ kind: "completed" });
    const complete = events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({
      answer: { answer: "No sources found.", citations: [], evidence: [] },
    });
    expect(events.find((event) => event.type === "tool-call-end")).toMatchObject({ ok: true });
  });
});
