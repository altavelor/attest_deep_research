import { resolveCapabilityMetadata, resolveWithMetadataResolvers } from "@adapters/settings";

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
});
