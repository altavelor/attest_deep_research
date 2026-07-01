import {
  capabilityCacheKey,
  CapabilityRefreshCoordinator,
  recordObservedReasoningFormat,
} from "@adapters/settings";

describe("model capability cache", () => {
  const identity = {
    baseUrl: "https://example.com/v1/",
    apiKey: "secret-key",
    model: "reasoner",
    protocol: "chat-completions" as const,
  };

  it("keys observations by normalized endpoint/model/protocol without exposing credentials", () => {
    const key = capabilityCacheKey(identity);
    expect(key).not.toContain("secret-key");
    expect(key).toContain("https://example.com/v1");
    expect(key).toContain("reasoner");
    expect(key).toContain("chat-completions");
  });

  it("merges passive formats without collapsing independent capability states", () => {
    const cache = recordObservedReasoningFormat({}, identity, "reasoning_content", "now");
    const snapshot = cache[capabilityCacheKey(identity)];
    expect(snapshot).toMatchObject({
      protocols: { chatCompletions: "supported", responses: "unknown" },
      reasoning: {
        responseFormats: ["reasoning_content"],
        visibleOutput: "supported",
      },
      continuation: "unknown",
      summary: "unknown",
      source: "observed",
    });
  });

  it("rejects stale refresh publications after identity changes", () => {
    const coordinator = new CapabilityRefreshCoordinator();
    const first = coordinator.begin("profile", "identity-a");
    const second = coordinator.begin("profile", "identity-b");
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
  });
});
