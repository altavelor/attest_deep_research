import { AgenticResearchRunner } from "../../src/research/AgenticResearchRunner";
import { ResearchExecutionPolicy } from "../../src/research/ResearchExecutionPolicy";
import { ResearchToolRegistry } from "../../src/research/tools/ResearchToolRegistry";
import { ResearchToolHandler } from "../../src/research/tools/ResearchTools";
import { ChatModelProvider, ChatRequest, ChatResponseChunk } from "../../src/shared/types";

class ScriptedProvider implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly rounds: ChatResponseChunk[][]) {}
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
  const handler: ResearchToolHandler<Record<string, unknown>, unknown> = {
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
  };
}

describe("AgenticResearchRunner", () => {
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
      chatModel: provider,
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: new ResearchToolRegistry([search.handler]),
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
      chatModel: repairProvider,
      model: "m",
      messages: [],
      tools: new ResearchToolRegistry([search.handler]),
      policy: policy(["search_index"]),
    }).run();
    expect(repaired).toMatchObject({ ok: true, repairedTools: ["search_index"] });
    expect(repairProvider.requests[1].toolChoice).toEqual({
      type: "specific",
      name: "search_index",
    });

    const failed = await new AgenticResearchRunner({
      chatModel: new ScriptedProvider([[{ content: "no tools", isComplete: true }]]),
      model: "m",
      messages: [],
      tools: new ResearchToolRegistry([search.handler, tool("search_web").handler]),
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
      chatModel: provider,
      model: "m",
      messages: [],
      tools: new ResearchToolRegistry([search.handler]),
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
      chatModel: provider,
      model: "m",
      messages: [],
      tools: new ResearchToolRegistry([search.handler]),
      policy: policy(["search_index"]),
    }).run();
    expect(result).toMatchObject({ ok: true, repairedTools: ["search_index"], duplicateCalls: 0 });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
