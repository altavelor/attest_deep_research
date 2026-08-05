import { createContextBudget } from "@application/use-cases/chat/contextBudget";

describe("context budget", () => {
  it("reserves output and history before allocating the explicit budget", () => {
    expect(
      createContextBudget({
        evidenceLimit: 4,
        contextLimitTokens: 1_000,
        reservedOutputTokens: 200,
        chatHistory: [{ role: "user", content: "word ".repeat(100) }],
      }),
    ).toEqual({ explicitTokens: 303 });
  });
});
