import { AgenticResearchRunner } from "../../src/application/use-cases/AgenticResearchRunner";
import { ChatCompletionsRoundAdapter } from "../../src/adapters/model-provider/chat/ChatCompletionsRoundAdapter";
import { ResearchExecutionPolicy } from "../../src/core/research/ResearchExecutionPolicy";
import { Tool, ToolManager } from "../../src/core/agent/tool";
import { ChatModelProvider, ChatRequest, ChatResponseChunk, ModelRoundProvider, ModelRoundRequest, ProviderContinuationState } from "../../src/core/agent/protocol";

class ScriptedProvider implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly rounds: ChatResponseChunk[][]) { }
  async listModels() {
    return ["m"];
  }
  async *streamChat(request: ChatRequest) {
    this.requests.push(request);
    for (const chunk of this.rounds.shift() ?? []) yield chunk;
  }
}

function tool(
  name: string,
  execute = vi.fn().mockResolvedValue({ ok: true, value: { results: [] } }),
) {
  const handler: Tool<Record<string, unknown>, unknown> = {
    definition: {
      type: "function",
      function: { name, description: name, parameters: { type: "object", properties: {} } },
    },
    parseInput: (value) => ({ ok: true, value }),
    execute,
  };
  return { handler, execute };
}

function policy(requiredTools: string[]): ResearchExecutionPolicy {
  return {
    strategy: "agentic",
    reason: "eligible",
    requiredTools,
    bootstrapChoice:
      requiredTools.length === 1
        ? { type: "specific", name: requiredTools[0] }
        : { type: "required" },
    parallelToolCalls: requiredTools.length > 1,
    supportsSpecificChoice: true,
  };
}

describe("AgenticResearchRunner", () => {
  it("keeps Responses continuation outside the message transcript", async () => {
    const search = tool("search_index");
    const continuation: ProviderContinuationState = {
      provider: "openai-compatible",
      dispose: vi.fn(),
    };
    const requests: ModelRoundRequest[] = [];
    const roundProvider: ModelRoundProvider = {
      listModels: async () => ["m"],
      runRound: vi.fn(async (request: ModelRoundRequest) => {
        requests.push(request);
        return requests.length === 1
          ? {
            items: [
              {
                type: "toolCall" as const,
                call: { id: "call-1", name: "search_index", arguments: {} },
              },
            ],
            continuation,
            stopReason: "tool_calls" as const,
          }
          : { items: [{ type: "text" as const, text: "final" }], stopReason: "complete" as const };
      }),
    };
    const result = await new AgenticResearchRunner({
      modelRound: roundProvider,
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: new ToolManager([search.handler]),
      policy: policy(["search_index"]),
    }).run();

    expect(result).toMatchObject({ ok: true, answerText: "final" });
    expect(requests[1].continuation).toBe(continuation);
    expect(requests[1].toolOutputs?.[0]).toMatchObject({ callId: "call-1" });
    expect(requests[1].messages).toEqual([{ role: "user", content: "q" }]);
  });

  it("attributes streamed reasoning segments to their round and phase", async () => {
    const search = tool("search_index");
    const roundProvider: ModelRoundProvider = {
      listModels: async () => ["m"],
      runRound: vi.fn(async (request: ModelRoundRequest) => {
        const isFirst = (roundProvider.runRound as ReturnType<typeof vi.fn>).mock.calls.length === 1;
        if (isFirst) {
          request.onDelta?.({ type: "reasoningSummary", segmentId: "s", text: "plan it" });
          return {
            items: [
              { type: "toolCall" as const, call: { id: "1", name: "search_index", arguments: {} } },
            ],
            stopReason: "tool_calls" as const,
          };
        }
        request.onDelta?.({ type: "reasoningSummary", segmentId: "s", text: "done now" });
        return { items: [{ type: "text" as const, text: "final" }], stopReason: "complete" as const };
      }),
    };
    const result = await new AgenticResearchRunner({
      modelRound: roundProvider,
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: new ToolManager([search.handler]),
      policy: policy(["search_index"]),
    }).run();

    expect(result.ok).toBe(true);
    expect(result.reasoningSegments).toEqual([
      { segmentId: "round-1-s", round: 1, phase: "bootstrap", chars: "plan it".length },
      { segmentId: "round-2-s", round: 2, phase: "research", chars: "done now".length },
    ]);
  });

  it("accepts only terminal text after successful mandatory execution", async () => {
    const search = tool("search_index");
    const provider = new ScriptedProvider([
      [
        {
          content: "discard me",
          isComplete: true,
          toolCalls: [{ id: "1", name: "search_index", arguments: {} }],
        },
      ],
      [{ content: "final answer", isComplete: true }],
    ]);
    const result = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: new ToolManager([search.handler]),
      policy: policy(["search_index"]),
    }).run();
    expect(result).toMatchObject({
      ok: true,
      answerText: "final answer",
      satisfiedTools: ["search_index"],
    });
    expect(JSON.stringify(result)).not.toContain("discard me");
    expect(provider.requests.map((request) => request.toolChoice)).toEqual([
      { type: "specific", name: "search_index" },
      { type: "auto" },
    ]);
  });

  it("uses exactly one specific repair and fails for multiple missing tools", async () => {
    const search = tool("search_index");
    const repairProvider = new ScriptedProvider([
      [{ content: "premature", isComplete: true }],
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "2", name: "search_index", arguments: {} }],
        },
      ],
      [{ content: "done", isComplete: true }],
    ]);
    const repaired = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(repairProvider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: policy(["search_index"]),
    }).run();
    expect(repaired).toMatchObject({ ok: true, repairedTools: ["search_index"] });
    expect(repairProvider.requests[1].toolChoice).toEqual({
      type: "specific",
      name: "search_index",
    });

    const failed = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(new ScriptedProvider([[{ content: "no tools", isComplete: true }]])),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler, tool("search_web").handler]),
      policy: policy(["search_index", "search_web"]),
    }).run();
    expect(failed).toMatchObject({ ok: false, reason: "multiple-mandatory-tools-unresolved" });
  });

  it("reuses duplicate results while counting calls", async () => {
    const search = tool("search_index");
    const call = { id: "1", name: "search_index", arguments: { query: "x" } };
    const provider = new ScriptedProvider([
      [{ content: "", isComplete: true, toolCalls: [call] }],
      [{ content: "", isComplete: true, toolCalls: [{ ...call, id: "2" }] }],
      [{ content: "done", isComplete: true }],
    ]);
    const result = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: policy(["search_index"]),
    }).run();
    expect(result).toMatchObject({ ok: true, totalCalls: 2, duplicateCalls: 1 });
    expect(search.execute).toHaveBeenCalledTimes(1);
  });

  it("executes one real retry for a retryable mandatory failure", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "temporary", message: "retry", retryable: true },
      })
      .mockResolvedValueOnce({ ok: true, value: { results: [] } });
    const search = tool("search_index", execute);
    const call = { id: "1", name: "search_index", arguments: { query: "x" } };
    const provider = new ScriptedProvider([
      [{ content: "", isComplete: true, toolCalls: [call] }],
      [{ content: "", isComplete: true, toolCalls: [{ ...call, id: "2" }] }],
      [{ content: "done", isComplete: true }],
    ]);
    const result = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: policy(["search_index"]),
    }).run();
    expect(result).toMatchObject({ ok: true, repairedTools: ["search_index"], duplicateCalls: 0 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("stops gathering and synthesizes when distinct queries surface no new evidence", async () => {
    // Distinct args each round (no exact-duplicate cache hit), but every search returns
    // the same chunk: round 1 makes progress, rounds 2-3 spin. Instead of failing to the
    // deterministic fallback, the loop switches to a tool-free synthesis round.
    const execute = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { results: [{ evidenceId: "e1", chunkId: "e1" }] } });
    const search = tool("search_index", execute);
    const provider = new ScriptedProvider([
      [{ content: "", isComplete: true, toolCalls: [{ id: "1", name: "search_index", arguments: { query: "a" } }] }],
      [{ content: "", isComplete: true, toolCalls: [{ id: "2", name: "search_index", arguments: { query: "b" } }] }],
      [{ content: "", isComplete: true, toolCalls: [{ id: "3", name: "search_index", arguments: { query: "c" } }] }],
      [{ content: "synthesized", isComplete: true }],
    ]);
    const result = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: policy(["search_index"]),
    }).run();
    // Gathering stops after 3 spinning rounds; the 4th round is forced tool-free.
    expect(result).toMatchObject({ ok: true, answerText: "synthesized" });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(provider.requests[3].toolChoice).toEqual({ type: "none" });
  });

  it("loop-detected still fails when a mandatory tool is unsatisfied", async () => {
    // No evidence ever surfaces and the required tool never returns a usable result, so the
    // run cannot honor its contract — synthesis is not an option, it must fall back.
    const execute = vi.fn().mockResolvedValue({ ok: false, error: { code: "x", message: "no", retryable: false } });
    const search = tool("search_web", execute);
    const provider = new ScriptedProvider([
      [{ content: "", isComplete: true, toolCalls: [{ id: "1", name: "search_web", arguments: { query: "a" } }] }],
      [{ content: "", isComplete: true, toolCalls: [{ id: "2", name: "search_web", arguments: { query: "b" } }] }],
      [{ content: "", isComplete: true, toolCalls: [{ id: "3", name: "search_web", arguments: { query: "c" } }] }],
    ]);
    const result = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: policy(["search_web"]),
    }).run();
    expect(result).toMatchObject({ ok: false });
  });

  it("synthesizes from gathered evidence when the result budget is exhausted", async () => {
    // A single oversized result blows the budget. The run must NOT fail to the
    // deterministic fallback — it should force a tool-free synthesis round and return
    // the model's own answer, with the offending result kept out of the transcript.
    const huge = "x".repeat(200);
    const search = tool(
      "search_web",
      vi.fn().mockResolvedValue({ ok: true, value: { results: [{ evidenceId: "e1", text: huge }] } }),
    );
    const provider = new ScriptedProvider([
      [{ content: "", isComplete: true, toolCalls: [{ id: "1", name: "search_web", arguments: { query: "a" } }] }],
      [{ content: "synthesized answer", isComplete: true }],
    ]);
    const result = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: policy([]),
      maxResultChars: 50,
    }).run();

    expect(result).toMatchObject({ ok: true, answerText: "synthesized answer" });
    // The second request is forced tool-free, and the oversized result was stubbed out.
    const synthesisRequest = provider.requests[1];
    expect(synthesisRequest.toolChoice).toEqual({ type: "none" });
    const toolMessage = synthesisRequest.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).not.toContain(huge);
    expect(synthesisRequest.messages.some((m) => m.role === "user" && /stop calling tools/i.test(String(m.content)))).toBe(true);
  });

  it("treats consecutive fetch_web_page reads as progress, not a loop", async () => {
    // The deep-research pattern: search once, then read several pages. fetch_web_page
    // reuses the evidenceId minted at search time, so rounds 2-3 surface no NEW id —
    // but each pulls fresh page content, which must count as progress (otherwise the
    // session loop-detects mid-read and never synthesizes).
    const search = tool(
      "search_index",
      vi.fn().mockResolvedValue({ ok: true, value: { results: [{ evidenceId: "e1" }] } }),
    );
    const fetch = tool(
      "fetch_web_page",
      vi.fn().mockResolvedValue({ ok: true, value: { evidenceId: "e1", content: "page text" } }),
    );
    const provider = new ScriptedProvider([
      [{ content: "", isComplete: true, toolCalls: [{ id: "1", name: "search_index", arguments: { query: "a" } }] }],
      [{ content: "", isComplete: true, toolCalls: [{ id: "2", name: "fetch_web_page", arguments: { resultId: "x" } }] }],
      [{ content: "", isComplete: true, toolCalls: [{ id: "3", name: "fetch_web_page", arguments: { resultId: "y" } }] }],
      [{ content: "final", isComplete: true }],
    ]);
    const result = await new AgenticResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler, fetch.handler]),
      policy: policy(["search_index"]),
    }).run();
    expect(result).toMatchObject({ ok: true, answerText: "final" });
    expect(fetch.execute).toHaveBeenCalledTimes(2);
  });
});
