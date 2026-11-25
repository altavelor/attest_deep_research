import { TokenUsageMeter } from "@application/use-cases/research/TokenUsageMeter";

describe("token usage meter", () => {
  it("adds the usage of model rounds and ignores counts that are not token counts", async () => {
    const meter = new TokenUsageMeter();
    const usages = [
      { inputTokens: 30, outputTokens: 5, reasoningTokens: 0, cachedInputTokens: 0 },
      { inputTokens: -1, outputTokens: 2.5, reasoningTokens: 0, cachedInputTokens: 0 },
      undefined,
    ];
    const rounds = meter.roundProvider({
      listModels: async () => [],
      runRound: async () => ({ items: [], stopReason: "complete", usage: usages.shift() }),
    });
    expect(meter.total()).toBeNull();
    for (let call = 0; call < 3; call += 1) await rounds.runRound({ model: "m", messages: [] });
    expect(meter.total()).toEqual({ inputTokens: 30, outputTokens: 5 });
    meter.add({ inputTokens: 1 });
    expect(meter.total()).toEqual({ inputTokens: 31, outputTokens: 5 });
  });
});
