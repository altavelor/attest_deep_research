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
              { id: "required-a", name: "attest_probe_a", arguments: {} },
              { id: "required-b", name: "attest_probe_b", arguments: {} },
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
    expect(result.probeAuditData.results.required).toContain("attest_probe_a");
    expect(result.probeAuditData.results.specific).toContain("attest_probe_b");
    expect(result.probeAuditData.results.auto).toEqual([]);
    expect(provider.requests).toHaveLength(2);
    expect(JSON.stringify(provider.requests)).not.toMatch(/vault|index|note|web/i);
  });

  it("fails closed on text and wrong tools", async () => {
    const textProvider = new ProbeProvider(() => ({ content: "no", isComplete: true }));
    const result = await probeToolControlCapabilities({
      provider: textProvider,
      model: "m",
      apiFormat: "openai-compatible",
    });
    expect(result.calls).toBe(false);
    expect(result.choiceRequired).toBe(false);
    expect(result.choiceSpecific).toBe(false);
    expect(result.parallelCalls).toBe(false);

    expect(result.probeAuditData.results.auto).toEqual([]);
  });

  it("rejects malformed synthetic arguments", async () => {
    const provider = new ProbeProvider((request) => ({
      content: "",
      isComplete: true,
      toolCalls: [
        {
          id: "p",
          name:
            request.toolChoice?.type === "specific" ? request.toolChoice.name : "attest_probe_a",
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
          toolCalls: [{ id: "a", name: "attest_probe_a", arguments: {} }],
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
    expect(result.probeAuditData.results.auto).toContain("attest_probe_a");
    expect(callCount).toBe(3);
  });

  it("propagates cancellation instead of reporting an empty probe result", async () => {
    const controller = new AbortController();
    const provider = new ProbeProvider(() => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });

    await expect(
      probeToolControlCapabilities({
        provider,
        model: "m",
        apiFormat: "openai-compatible",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.requests).toHaveLength(1);
  });

  it("stops before the next request when the caller cancels between probes", async () => {
    const controller = new AbortController();
    const provider = new ProbeProvider(() => {
      controller.abort();
      return { content: "", isComplete: true, toolCalls: [] };
    });

    await expect(
      probeToolControlCapabilities({
        provider,
        model: "m",
        apiFormat: "openai-compatible",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(provider.requests).toHaveLength(1);
  });
});
