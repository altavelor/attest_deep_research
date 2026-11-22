import type { ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";
import { validateResearchSection, type ResearchState } from "@core/research/deepResearch";
import { collectAsync } from "../support/async";
import { MemoryResearchState, deepResearchService, planReply } from "../support/deepResearch";

class ClarifyingModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    const clarification = String(request.messages[0]?.content).startsWith("You decide");
    yield {
      content: clarification
        ? JSON.stringify({
            status: "questions",
            assumptions: ["Ocean tides"],
            questions: [{ prompt: "Which body of water?", suggestions: ["Ocean", "Lake"] }],
          })
        : planReply(),
      isComplete: true,
    };
  }
}

function reloaded(state: ResearchState): MemoryResearchState {
  const stored = validateResearchSection(
    JSON.parse(JSON.stringify({ schema: 1, active: state, history: [] })),
  );
  const port = new MemoryResearchState();
  if (stored.ok) port.commits.push(stored.value.active!);
  return port;
}

function answerTurn(model: ClarifyingModel, port: MemoryResearchState, answers: object) {
  const asked = port.commits.at(-1)!;
  return collectAsync(
    deepResearchService(model).answer({
      question: "Answer",
      mode: "deep-research",
      researchState: port,
      research: {
        type: "decision",
        decision: {
          researchId: asked.researchId,
          decisionId: asked.pending!.decisionId,
          expectedRevision: asked.revision,
          payload: { action: "answer", answers },
        },
      },
    }),
  );
}

describe("deep research brief", () => {
  it("asks one round of questions, survives a reload and plans from the answers", async () => {
    const model = new ClarifyingModel();
    const first = new MemoryResearchState();
    await collectAsync(
      deepResearchService(model).answer({
        question: "How do tides work?",
        mode: "deep-research",
        researchState: first,
      }),
    );
    const asked = first.commits.at(-1)!;
    expect(asked).toMatchObject({
      phase: "awaiting-clarification",
      pending: { kind: "clarification" },
      plan: null,
    });
    expect(model.requests).toHaveLength(1);

    const port = reloaded(asked);
    await expect(answerTurn(model, port, { "question-9": "Ocean" })).rejects.toMatchObject({
      message: "The clarification answers a question that was not asked.",
      details: { reason: "research-invalid-decision" },
    });
    expect(model.requests).toHaveLength(1);

    await answerTurn(model, port, { "question-1": "The Atlantic" });
    const planned = port.commits.at(-1)!;
    expect(planned).toMatchObject({
      phase: "awaiting-approval",
      pending: { kind: "plan" },
      plan: { generationsUsed: 1 },
      brief: { answers: { "question-1": "The Atlantic" }, assumptions: ["Ocean tides"] },
    });
    expect(String(model.requests.at(-1)?.messages.at(-1)?.content)).toContain(
      "Which body of water? → The Atlantic",
    );
  });
});
