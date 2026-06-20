import { probeToolControlCapabilities } from "../../src/settings/toolCapabilityProbe";
import { ChatModelProvider, ChatRequest, ChatResponseChunk } from "../../src/shared/types";

class ProbeProvider implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly respond: (request: ChatRequest) => ChatResponseChunk) {}
  async listModels(): Promise<string[]> {
    return ["m"];
  }
  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    yield this.respond(request);
  }
}

describe("probeToolControlCapabilities", () => {
  it("verifies required and exact specific tool calls using synthetic data", async () => {
    const provider = new ProbeProvider((request) => ({
      content: "",
      isComplete: true,
      toolCalls: [
        {
          id: "p",
          name:
            request.toolChoice?.type === "specific" ? request.toolChoice.name : "ixplorer_probe_a",
          arguments: {},
        },
      ],
    }));
    await expect(
      probeToolControlCapabilities({ provider, model: "m", apiFormat: "openai-compatible" }),
    ).resolves.toEqual({ calls: true, choiceRequired: true, choiceSpecific: true });
    expect(provider.requests).toHaveLength(2);
    expect(JSON.stringify(provider.requests)).not.toMatch(/vault|index|note|web/i);
  });

  it("fails closed on text, wrong tools, and Ollama", async () => {
    const textProvider = new ProbeProvider(() => ({ content: "no", isComplete: true }));
    await expect(
      probeToolControlCapabilities({ provider: textProvider, model: "m", apiFormat: "anthropic" }),
    ).resolves.toEqual({ calls: false, choiceRequired: false, choiceSpecific: false });
    const unused = new ProbeProvider(() => {
      throw new Error("must not run");
    });
    await expect(
      probeToolControlCapabilities({ provider: unused, model: "m", apiFormat: "ollama" }),
    ).resolves.toEqual({ calls: false, choiceRequired: false, choiceSpecific: false });
    expect(unused.requests).toHaveLength(0);
  });

  it("rejects malformed synthetic arguments", async () => {
    const provider = new ProbeProvider((request) => ({
      content: "",
      isComplete: true,
      toolCalls: [
        {
          id: "p",
          name:
            request.toolChoice?.type === "specific" ? request.toolChoice.name : "ixplorer_probe_a",
          arguments: { raw: "{" },
        },
      ],
    }));
    await expect(
      probeToolControlCapabilities({ provider, model: "m", apiFormat: "openai-compatible" }),
    ).resolves.toEqual({ calls: false, choiceRequired: false, choiceSpecific: false });
  });
});
