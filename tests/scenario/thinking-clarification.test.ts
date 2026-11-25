import { ThinkingResearchStrategy } from "@application/use-cases/research/strategies/ThinkingResearchStrategy";
import type {
  ResearchExecutionContext,
  ResearchStrategyDeps,
} from "@application/use-cases/research/strategies/ResearchStrategy";
import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import type { ModelRoundResult } from "@core/agent";
import type { ResearchChatHistoryMessage } from "@core/research";
import { researchModeRetrievalParameters } from "@core/research";
import { collectAsync } from "../support/async";
import { fixedNow } from "../support/factories";
import { FakeRetriever, scriptedModelRounds } from "../support/researchFakes";

const ASK = "ask_clarification";

function clarifyingCall(questions: unknown): ModelRoundResult {
  return {
    items: [{ type: "toolCall", call: { id: "c1", name: ASK, arguments: { questions } } }],
    stopReason: "tool_calls",
  };
}

const FINAL: ModelRoundResult = {
  items: [{ type: "text", text: "Answer." }],
  stopReason: "complete",
};

function run(
  handler: Parameters<typeof scriptedModelRounds>[0],
  chatHistory: ResearchChatHistoryMessage[] = [],
) {
  const modelRound = scriptedModelRounds(handler);
  const deps = {
    chatModelName: "m",
    chatOptions: {},
    modelRound,
    modelRoundFactory: () => modelRound,
    retriever: new FakeRetriever({ chunks: [], citations: [], usedFallback: false }),
    evidenceLimit: 5,
    toolsetFactory: createResearchToolRegistry,
    toolsEnabled: true,
    toolCapabilities: {
      calls: true,
      choiceRequired: true,
      choiceSpecific: true,
      parallelCalls: true,
    },
    now: fixedNow,
  } as unknown as ResearchStrategyDeps;
  const ctx: ResearchExecutionContext = {
    request: { question: "Should I move to SQLite?", mode: "thinking", chatHistory },
    question: "Should I move to SQLite?",
    searchMode: "indexOnly",
    retrieval: researchModeRetrievalParameters("thinking"),
    policy: {
      strategy: "thinking",
      reason: "thinking-eligible",
      requiredTools: [],
      bootstrapChoice: { type: "auto" },
      parallelToolCalls: true,
      supportsSpecificChoice: true,
    },
  };
  const strategy = new ThinkingResearchStrategy(deps);
  return { modelRound, events: collectAsync(strategy.execute(ctx)) };
}

describe("Thinking clarification tool", () => {
  it("ends the turn with the stored questions before the parallel call runs", async () => {
    const { modelRound, events } = run(() => {
      const round = clarifyingCall([
        { prompt: " Which database now? ", suggestions: ["Postgres", "Files"] },
      ]);
      round.items.push({
        type: "toolCall",
        call: { id: "s1", name: "search_index", arguments: { query: "sqlite" } },
      });
      return round;
    });

    const all = await events;
    const complete = all.find((event) => event.type === "complete");

    expect(modelRound.requests).toHaveLength(1);
    expect(modelRound.requests[0]!.messages[0]!.content).toContain(`(${ASK})`);
    expect(modelRound.requests[0]!.messages[0]!.content).toContain(`only in the ${ASK} arguments`);
    const ended = all.filter((event) => event.type === "tool-call-end");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ id: "c1" });
    expect(complete).toMatchObject({
      answer: {
        answer: "",
        clarification: {
          questions: [
            {
              questionId: "question-1",
              prompt: "Which database now?",
              suggestions: ["Postgres", "Files"],
            },
          ],
        },
      },
    });
  });

  it("rejects a call without a usable question and lets the run answer", async () => {
    const { modelRound, events } = run((_request, index) =>
      index === 1 ? clarifyingCall([{ prompt: "  " }]) : FINAL,
    );

    const all = await events;

    expect(modelRound.requests).toHaveLength(2);
    expect(all.find((event) => event.type === "tool-call-end")).toMatchObject({
      ok: false,
      resultJson: expect.stringContaining("invalid-clarification"),
    });
    const complete = all.find((event) => event.type === "complete");
    expect(complete).toMatchObject({ answer: { answer: "Answer." } });
    expect(complete?.type === "complete" && complete.answer.clarification).toBeFalsy();
  });

  it("does not offer the tool right after a clarification turn", async () => {
    const { modelRound, events } = run(
      () => FINAL,
      [
        { role: "user", content: "Should I move to SQLite?" },
        { role: "assistant", content: "", clarification: true },
        { role: "user", content: "Answers" },
      ],
    );
    await events;

    const offered = modelRound.requests[0]!.tools!.map((tool) => tool.function.name);
    expect(offered).not.toContain(ASK);
    expect(modelRound.requests[0]!.messages[0]!.content).not.toContain(ASK);
  });
});
