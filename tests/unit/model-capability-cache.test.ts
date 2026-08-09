import {
  capabilityCacheKey,
  CapabilityRefreshCoordinator,
  readModelCapabilityCache,
  reasoningEffortCandidates,
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

  it("uses an advertised default reasoning effort when no list is available", () => {
    expect(
      reasoningEffortCandidates({
        reasoning: { responseFormats: [], defaultEffort: "minimal", visibleOutput: "unknown" },
      }),
    ).toEqual(["minimal"]);
  });

  it("deduplicates advertised efforts and ignores empty values", () => {
    expect(
      reasoningEffortCandidates({
        reasoning: {
          responseFormats: [],
          efforts: ["low", "", "low", "high"],
          defaultEffort: "minimal",
          visibleOutput: "unknown",
        },
      }),
    ).toEqual(["low", "high"]);
  });

  it("keeps only valid persisted snapshots and normalizes legacy capability fields", () => {
    const cache = readModelCapabilityCache({
      valid: {
        protocols: { chatCompletions: "supported", responses: "invalid" },
        reasoning: {
          responseFormats: ["inline-tags", "thinking", "thinking", "unsupported"],
          visibleOutput: "unsupported",
          efforts: ["low", "", "low"],
          defaultEffort: "medium",
        },
        tools: "supported",
        continuation: "unsupported",
        summary: "invalid",
        source: "probe",
        checkedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
      },
      invalidSource: { protocols: {}, reasoning: {}, source: "other" },
      invalidShape: [],
    });

    expect(cache).toEqual({
      valid: {
        protocols: { chatCompletions: "supported", responses: "unknown" },
        reasoning: {
          responseFormats: ["inline_tags", "thinking"],
          visibleOutput: "unsupported",
          efforts: ["low"],
          defaultEffort: "medium",
        },
        tools: "supported",
        continuation: "unsupported",
        summary: "unknown",
        source: "probe",
        checkedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:00:00.000Z",
        contractVersion: 1,
      },
    });
    expect(readModelCapabilityCache(null)).toEqual({});
  });

  it("records observations for the Responses endpoint and ignores unknown formats", () => {
    const responsesIdentity = { ...identity, protocol: "responses" as const };

    expect(recordObservedReasoningFormat({}, responsesIdentity, "unknown", "now")).toEqual({});
    const cache = recordObservedReasoningFormat({}, responsesIdentity, "responses_text", "now");
    expect(cache[capabilityCacheKey(responsesIdentity)]?.protocols).toEqual({
      chatCompletions: "unknown",
      responses: "supported",
    });
  });
});
