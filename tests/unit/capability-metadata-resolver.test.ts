import {
  extractReasoningEfforts,
  resolveCapabilityMetadata,
  resolveWithMetadataResolvers,
} from "@adapters/settings";

describe("capability metadata resolvers", () => {
  it("returns unknown when generic metadata has no capability hints", async () => {
    await expect(resolveWithMetadataResolvers([], { id: "model" })).resolves.toBeUndefined();
    expect(resolveCapabilityMetadata({ id: "model" })).toBeUndefined();
  });

  it("maps metadata-rich compatible fields into the common snapshot", () => {
    expect(
      resolveCapabilityMetadata({
        id: "reasoner",
        supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
        supported_parameters: ["tools", "reasoning_effort", "reasoning_summary"],
        reasoning_formats: ["reasoning_content", "responses_summary"],
      }),
    ).toMatchObject({
      protocols: { chatCompletions: "supported", responses: "supported" },
      reasoning: {
        responseFormats: ["reasoning_content", "responses_summary"],
        visibleOutput: "supported",
      },
      tools: "supported",
      summary: "supported",
      source: "metadata",
    });
  });

  it("reads the reasoning effort list an OpenRouter model advertises", () => {
    const metadata = {
      id: "qwen/qwen3.8-2.4t-a95b",
      supported_parameters: ["reasoning", "reasoning_effort", "tools"],
      reasoning: {
        mandatory: true,
        default_enabled: true,
        supported_efforts: ["xhigh", "medium", "low"],
        default_effort: "xhigh",
      },
    };

    expect(extractReasoningEfforts(metadata)).toEqual(["xhigh", "medium", "low"]);
    expect(resolveCapabilityMetadata(metadata)?.reasoning).toMatchObject({
      efforts: ["xhigh", "medium", "low"],
      defaultEffort: "xhigh",
    });
  });

  it("recognises tool calling across provider parameter names and flags", () => {
    expect(resolveCapabilityMetadata({ supported_parameters: ["tools"] })?.tools).toBe("supported");
    expect(resolveCapabilityMetadata({ supported_parameters: ["tool_choice"] })?.tools).toBe(
      "supported",
    );
    expect(resolveCapabilityMetadata({ supported_parameters: ["function_calling"] })?.tools).toBe(
      "supported",
    );
    expect(
      resolveCapabilityMetadata({
        supported_parameters: ["temperature"],
        capabilities: { function_calling: true },
      })?.tools,
    ).toBe("supported");
    expect(resolveCapabilityMetadata({ supported_parameters: ["temperature"] })?.tools).toBe(
      "unknown",
    );
  });

  it("projects advertised tool controls into the snapshot", () => {
    expect(
      resolveCapabilityMetadata({
        supported_parameters: ["tools", "tool_choice", "parallel_tool_calls"],
      })?.toolControls,
    ).toEqual({ choiceRequired: true, choiceSpecific: true, parallelCalls: true });
    expect(resolveCapabilityMetadata({ supported_parameters: ["tools"] })?.toolControls).toEqual({
      choiceRequired: false,
      choiceSpecific: false,
      parallelCalls: false,
    });
  });

  it("isolates resolver failure and continues with the next resolver", async () => {
    const snapshot = resolveCapabilityMetadata({
      supported_endpoints: ["/chat/completions"],
      reasoning_formats: ["thinking"],
    })!;
    await expect(
      resolveWithMetadataResolvers(
        [
          { resolve: async () => Promise.reject(new Error("metadata unavailable")) },
          { resolve: async () => snapshot },
        ],
        {},
      ),
    ).resolves.toEqual(snapshot);
  });

  it("uses the first non-empty advertised reasoning effort list and default", () => {
    const metadata = {
      supported_reasoning_efforts: ["low", "low", "high"],
      reasoning: { efforts: ["minimal"], default_effort: "low" },
    };
    expect(extractReasoningEfforts(metadata)).toEqual(["low", "high"]);
    expect(resolveCapabilityMetadata(metadata)?.reasoning).toMatchObject({
      efforts: ["low", "high"],
      defaultEffort: "low",
    });
  });
});
