import { resolveAgenticMaxResultChars } from "@application/use-cases/research/strategies/AgenticResearchStrategy";

describe("resolveAgenticMaxResultChars", () => {
  it("keeps the legacy fallback when context size is unknown", () => {
    expect(resolveAgenticMaxResultChars({ usedTokens: 1_000 })).toBe(80_000);
  });

  it("scales the tool result budget with the remaining context window", () => {
    expect(
      resolveAgenticMaxResultChars({
        contextLimitTokens: 1_048_576,
        usedTokens: 6_000,
      }),
    ).toBe(1_000_000);
  });

  it("keeps a floor for small context windows", () => {
    expect(
      resolveAgenticMaxResultChars({
        contextLimitTokens: 32_000,
        usedTokens: 8_000,
      }),
    ).toBe(80_000);
  });
});
