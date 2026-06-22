import { resolveResearchExecutionPolicy } from "../../src/research/ResearchExecutionPolicy";

const fullCapabilities = {
  calls: true,
  choiceRequired: true,
  choiceSpecific: true,
  parallelCalls: true,
} as const;

describe("resolveResearchExecutionPolicy", () => {
  it.each([
    ["none", []],
    ["indexOnly", ["search_index"]],
    ["indexAndWeb", ["search_index", "search_web"]],
    ["webOnly", ["search_web"]],
  ] as const)(
    "computes mandatory tools for %s",
    (searchMode, expected) => {
      const policy = resolveResearchExecutionPolicy({
        forceEagerResearch: false,
        deepResearch: false,
        searchMode,
        dependencies: { retriever: true, webProvider: true },
        capabilities: fullCapabilities,
      });

      expect(policy.requiredTools).toEqual(expected);
      expect(policy.strategy).toBe("agentic");
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

  it.each([
    [{ ...fullCapabilities, calls: false }, "tool-calls-unavailable"],
    [{ ...fullCapabilities, choiceSpecific: false }, "specific-choice-unavailable"],
    [{ ...fullCapabilities, choiceRequired: false }, "required-choice-unavailable"],
    [{ ...fullCapabilities, parallelCalls: false }, "parallel-calls-unavailable"],
  ] as const)("fails closed for missing capability %s", (capabilities, reason) => {
    const searchMode = reason === "specific-choice-unavailable" ? "indexOnly" : "indexAndWeb";
    const policy = resolveResearchExecutionPolicy({
      forceEagerResearch: false,
      deepResearch: false,
      searchMode,
      dependencies: { retriever: true, webProvider: true },
      capabilities,
    });
    expect(policy).toMatchObject({ strategy: "deterministic-fallback", reason });
  });

  it.each([
    ["indexOnly", { retriever: false, webProvider: true }, "retriever-unavailable"],
    ["webOnly", { retriever: true, webProvider: false }, "web-provider-unavailable"],
  ] as const)(
    "fails closed when a required dependency is missing",
    (searchMode, dependencies, reason) => {
      expect(
        resolveResearchExecutionPolicy({
          forceEagerResearch: false,
          deepResearch: false,
          searchMode,
          dependencies,
          capabilities: fullCapabilities,
        }),
      ).toMatchObject({ strategy: "deterministic-fallback", reason });
    },
  );

  it("selects auto, specific, or required bootstrap choice", () => {
    const resolve = (searchMode: "none" | "indexOnly" | "indexAndWeb") =>
      resolveResearchExecutionPolicy({
        forceEagerResearch: false,
        deepResearch: false,
        searchMode,
        dependencies: { retriever: true, webProvider: true },
        capabilities: fullCapabilities,
      }).bootstrapChoice;
    expect(resolve("none")).toEqual({ type: "auto" });
    expect(resolve("indexOnly")).toEqual({ type: "specific", name: "search_index" });
    expect(resolve("indexAndWeb")).toEqual({ type: "required" });
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
