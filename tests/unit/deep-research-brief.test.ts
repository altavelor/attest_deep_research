import { ResearchClarificationService } from "@application/use-cases/research/deep-research";
import { NO_CLARIFICATION_ASSUMPTION } from "@core/research/deepResearch";
import { FakeChatModel } from "../support/researchFakes";

describe("deep research clarification", () => {
  it("turns malformed clarification output into assumptions without a second call", async () => {
    const model = new FakeChatModel([{ content: "Sure, let me think.", isComplete: true }]);
    const outcome = await new ResearchClarificationService({
      chatModel: model,
      model: "model",
      chatOptions: {},
    }).decide("Tides?");

    expect(outcome).toEqual({
      kind: "ready",
      assumptions: [NO_CLARIFICATION_ASSUMPTION],
      failed: true,
    });
    expect(model.requests).toHaveLength(1);
  });
});
