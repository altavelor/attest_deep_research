import { resolveResearchExecutionPolicy } from "../../src/core/research/ResearchExecutionPolicy";

const fullCapabilities = {
  calls: true,
  choiceRequired: true,
  choiceSpecific: true,
  parallelCalls: true,
} as const;

describe("resolveResearchExecutionPolicy", () => {
  it.each(["none", "indexOnly", "indexAndWeb", "webOnly"] as const)(
    "never mandates tools for %s — the model chooses via auto",
    (searchMode) => {
      const policy = resolveResearchExecutionPolicy({
        forceEagerResearch: false,
        deepResearch: false,
        searchMode,
        dependencies: { retriever: true, webProvider: true },
        capabilities: fullCapabilities,
      });

      expect(policy.requiredTools).toEqual([]);
      expect(policy.bootstrapChoice).toEqual({ type: "auto" });
      expect(policy.strategy).toBe("agentic");
      expect(policy.reason).toBe("eligible");
      expect(Object.isFrozen(policy)).toBe(true);
    },
  );

  it("gives forced eager and deep research precedence", () => {
    expect(
      resolveResearchExecutionPolicy({
        forceEagerResearch: true,
        deepResearch: false,
        searchMode: "indexOnly",
        dependencies: { retriever: false, webProvider: false },
        capabilities: fullCapabilities,
      }).strategy,
    ).toBe("eager-forced");
    expect(
      resolveResearchExecutionPolicy({
        forceEagerResearch: false,
        deepResearch: true,
        searchMode: "indexOnly",
        dependencies: { retriever: true, webProvider: true },
        capabilities: fullCapabilities,
      }),
    ).toMatchObject({ strategy: "eager-default", reason: "deep-research-eager" });
  });

  it("falls back to deterministic only when the model cannot call tools at all", () => {
    const policy = resolveResearchExecutionPolicy({
      forceEagerResearch: false,
      deepResearch: false,
      searchMode: "indexAndWeb",
      dependencies: { retriever: true, webProvider: true },
      capabilities: { ...fullCapabilities, calls: false },
    });
    expect(policy).toMatchObject({
      strategy: "deterministic-fallback",
      reason: "tool-calls-unavailable",
    });
  });

  it.each([
    [{ ...fullCapabilities, choiceSpecific: false, choiceRequired: false }],
    [{ ...fullCapabilities, choiceRequired: false }],
    [{ ...fullCapabilities, parallelCalls: false }],
  ] as const)(
    "stays agentic regardless of tool-choice/parallel capability (no forcing)",
    (capabilities) => {
      const policy = resolveResearchExecutionPolicy({
        forceEagerResearch: false,
        deepResearch: false,
        searchMode: "indexAndWeb",
        dependencies: { retriever: true, webProvider: true },
        capabilities,
      });
      expect(policy).toMatchObject({ strategy: "agentic", reason: "eligible" });
      expect(policy.bootstrapChoice).toEqual({ type: "auto" });
    },
  );

  it("mirrors parallel-call capability without requiring it", () => {
    expect(
      resolveResearchExecutionPolicy({
        forceEagerResearch: false,
        deepResearch: false,
        searchMode: "indexAndWeb",
        dependencies: { retriever: true, webProvider: true },
        capabilities: fullCapabilities,
      }).parallelToolCalls,
    ).toBe(true);
    expect(
      resolveResearchExecutionPolicy({
        forceEagerResearch: false,
        deepResearch: false,
        searchMode: "indexAndWeb",
        dependencies: { retriever: true, webProvider: true },
        capabilities: { ...fullCapabilities, parallelCalls: false },
      }).parallelToolCalls,
    ).toBe(false);
  });

  it("keeps Ollama on deterministic fallback even with manual-looking flags", () => {
    expect(
      resolveResearchExecutionPolicy({
        forceEagerResearch: false,
        deepResearch: false,
        searchMode: "indexOnly",
        dependencies: { retriever: true, webProvider: true },
        capabilities: fullCapabilities,
        apiFormat: "ollama",
      }),
    ).toMatchObject({
      strategy: "deterministic-fallback",
      reason: "provider-tool-control-unsupported",
    });
  });
});
