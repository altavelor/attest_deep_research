import { probeToolControlCapabilities } from "@adapters/settings";
import { ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";

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
      toolCalls:
        request.toolChoice?.type === "specific"
          ? [{ id: "specific", name: request.toolChoice.name, arguments: {} }]
          : [
              { id: "required-a", name: "ixplorer_probe_a", arguments: {} },
              { id: "required-b", name: "ixplorer_probe_b", arguments: {} },
            ],
    }));
    const result = await probeToolControlCapabilities({
      provider,
      model: "m",
      apiFormat: "openai-compatible",
    });
    expect(result.calls).toBe(true);
    expect(result.choiceRequired).toBe(true);
    expect(result.choiceSpecific).toBe(true);
    expect(result.parallelCalls).toBe(true);

    expect(result.probeAuditData.ranAt).toBeTruthy();
    expect(result.probeAuditData.results.required).toContain("ixplorer_probe_a");
    expect(result.probeAuditData.results.specific).toContain("ixplorer_probe_b");
    expect(result.probeAuditData.results.auto).toEqual([]);
    expect(provider.requests).toHaveLength(2);
    expect(JSON.stringify(provider.requests)).not.toMatch(/vault|index|note|web/i);
  });

  it("fails closed on text, wrong tools, and Ollama", async () => {
    const textProvider = new ProbeProvider(() => ({ content: "no", isComplete: true }));
    const result = await probeToolControlCapabilities({
      provider: textProvider,
      model: "m",
      apiFormat: "anthropic",
    });
    expect(result.calls).toBe(false);
    expect(result.choiceRequired).toBe(false);
    expect(result.choiceSpecific).toBe(false);
    expect(result.parallelCalls).toBe(false);

    expect(result.probeAuditData.results.auto).toEqual([]);

    const unused = new ProbeProvider(() => {
      throw new Error("must not run");
    });
    const ollamaResult = await probeToolControlCapabilities({
      provider: unused,
      model: "m",
      apiFormat: "ollama",
    });
    expect(ollamaResult.calls).toBe(false);
    expect(ollamaResult.choiceRequired).toBe(false);
    expect(ollamaResult.choiceSpecific).toBe(false);
    expect(ollamaResult.parallelCalls).toBe(false);
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
    const result = await probeToolControlCapabilities({
      provider,
      model: "m",
      apiFormat: "openai-compatible",
    });
    expect(result.calls).toBe(false);
    expect(result.choiceRequired).toBe(false);
    expect(result.choiceSpecific).toBe(false);
    expect(result.parallelCalls).toBe(false);
  });

  it("falls back to auto probe when required and specific probes return no calls", async () => {
    let callCount = 0;
    const provider = new ProbeProvider((request) => {
      callCount += 1;

      if (request.toolChoice?.type === "auto") {
        return {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "a", name: "ixplorer_probe_a", arguments: {} }],
        };
      }
      return { content: "", isComplete: true };
    });
    const result = await probeToolControlCapabilities({
      provider,
      model: "m",
      apiFormat: "openai-compatible",
    });
    expect(result.calls).toBe(true);
    expect(result.choiceRequired).toBe(false);
    expect(result.choiceSpecific).toBe(false);
    expect(result.probeAuditData.results.auto).toContain("ixplorer_probe_a");
    expect(callCount).toBe(3);
  });
});
