import { mergeChatProfileSettingsPreservingProbe } from "@adapters/settings";
import { createToolCapabilitySettings, withProbeResults } from "@adapters/settings";

describe("chat model profile save", () => {
  it("preserves probe-owned capabilities when saving edited form fields", () => {
    const current = {
      id: "chat-1",
      name: "Existing",
      serverProfileId: "server-1",
      modelName: "model-1",
      toolsEnabled: false,
      noteMutationAccess: false,
      reasoning: { mode: "on" as const, summary: "off" as const },
      reasoningCapabilities: {
        source: "probe" as const,
        responses: true,
        continuation: true,
        summary: false,
        efforts: ["low"],
      },
      capabilities: {
        chat: true,
        embeddings: false,
        tools: true,
        toolCalling: withProbeResults(createToolCapabilitySettings(), { calls: true }),
        detectionSource: "probe" as const,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const updated = {
      ...current,
      name: "Renamed",
      capabilities: { ...current.capabilities, tools: false },
      reasoningCapabilities: undefined,
    };

    expect(mergeChatProfileSettingsPreservingProbe(current, updated)).toMatchObject({
      name: "Renamed",
      capabilities: { tools: true, toolCalling: current.capabilities.toolCalling },
      reasoningCapabilities: current.reasoningCapabilities,
    });
  });
});
