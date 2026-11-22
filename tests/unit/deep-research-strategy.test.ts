import { DeepResearchStrategy } from "@application/use-cases/research/deep-research";
import type { ResearchExecutionContext } from "@application/use-cases/research/strategies/ResearchStrategy";
import { collectAsync } from "../support/async";
import { MemoryResearchState, deepResearchService } from "../support/deepResearch";
import { FakeChatModel } from "../support/researchFakes";

describe("deep research strategy", () => {
  it("ends the research as failed with a bounded reason when the provider error is huge", async () => {
    const port = new MemoryResearchState();
    const strategy = new DeepResearchStrategy({
      chatModel: {
        listModels: async () => [],
        async *streamChat() {
          throw new Error("x".repeat(5000));
        },
      },
      chatModelName: "model",
      chatOptions: {},
      toolCapabilities: {
        calls: true,
        choiceRequired: true,
        choiceSpecific: true,
        parallelCalls: false,
      },
      hasIndex: true,
      hasWeb: false,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const ctx = {
      request: { question: "Question", researchState: port },
      question: "Question",
      searchMode: "indexOnly",
    } as unknown as ResearchExecutionContext;

    await expect(collectAsync(strategy.execute(ctx))).rejects.toThrow(
      "The plan could not be generated",
    );
    const ended = port.commits.at(-1)!;
    expect(ended.phase).toBe("failed");
    expect(ended.terminalReason!.length).toBeLessThanOrEqual(500);
  });

  it("refuses a saved deep-research mode without contacting the model when the flag is off", async () => {
    const model = new FakeChatModel();
    const answer = deepResearchService(model, false).answer({
      question: "Q",
      mode: "deep-research",
    });
    await expect(collectAsync(answer)).rejects.toMatchObject({
      message: "Deep Research is not enabled.",
      details: { reason: "research-disabled" },
    });
    expect(model.requests).toHaveLength(0);
  });
});
