import { resolveResearchExecutionPolicy } from "@core/research";

const fullCapabilities = {
  calls: true,
  choiceRequired: true,
  choiceSpecific: true,
  parallelCalls: true,
} as const;

describe("resolveResearchExecutionPolicy", () => {
  it("selects Instant without requiring tool capabilities", () => {
    const policy = resolveResearchExecutionPolicy({
      mode: "instant",
      capabilities: { ...fullCapabilities, calls: false },
    });

    expect(policy.requiredTools).toEqual([]);
    expect(policy.bootstrapChoice).toEqual({ type: "auto" });
    expect(policy.strategy).toBe("instant");
    expect(policy.reason).toBe("instant-selected");
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("falls back to Instant when Thinking cannot call tools", () => {
    const policy = resolveResearchExecutionPolicy({
      mode: "thinking",
      capabilities: { ...fullCapabilities, calls: false },
    });
    expect(policy).toMatchObject({
      strategy: "instant-fallback",
      reason: "tool-calls-unavailable",
    });
  });

  it.each([
    [{ ...fullCapabilities, choiceSpecific: false, choiceRequired: false }],
    [{ ...fullCapabilities, choiceRequired: false }],
    [{ ...fullCapabilities, parallelCalls: false }],
  ] as const)(
    "keeps Thinking available regardless of tool-choice/parallel capability",
    (capabilities) => {
      const policy = resolveResearchExecutionPolicy({
        mode: "thinking",
        capabilities,
      });
      expect(policy).toMatchObject({ strategy: "thinking", reason: "thinking-eligible" });
      expect(policy.bootstrapChoice).toEqual({ type: "auto" });
    },
  );

  it("mirrors parallel-call capability without requiring it", () => {
    expect(
      resolveResearchExecutionPolicy({
        mode: "thinking",
        capabilities: fullCapabilities,
      }).parallelToolCalls,
    ).toBe(true);
    expect(
      resolveResearchExecutionPolicy({
        mode: "thinking",
        capabilities: { ...fullCapabilities, parallelCalls: false },
      }).parallelToolCalls,
    ).toBe(false);
  });

  it("keeps Ollama on deterministic fallback even with manual-looking flags", () => {
    expect(
      resolveResearchExecutionPolicy({
        mode: "thinking",
        capabilities: fullCapabilities,
        apiFormat: "ollama",
      }),
    ).toMatchObject({
      strategy: "instant-fallback",
      reason: "provider-tool-control-unsupported",
    });
  });

  it("describes Deep Research without selecting an implementation", () => {
    expect(
      resolveResearchExecutionPolicy({ mode: "deep-research", capabilities: fullCapabilities }),
    ).toMatchObject({ strategy: "deep-research", reason: "deep-research-selected" });
  });
});
