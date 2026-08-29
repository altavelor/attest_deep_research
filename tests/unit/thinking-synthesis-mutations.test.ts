import { ThinkingResearchRunner } from "@application/use-cases/research/ThinkingResearchRunner";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import { ResearchExecutionPolicy } from "@core/research";
import { Tool } from "@core/agent";
import { ToolManager } from "@application/tools/ToolManager";
import { ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";

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

function tool(name: string, execute: Tool<Record<string, unknown>, unknown>["execute"]) {
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

const OPEN_POLICY: ResearchExecutionPolicy = {
  strategy: "thinking",
  reason: "thinking-eligible",
  requiredTools: [],
  bootstrapChoice: { type: "auto" },
  parallelToolCalls: true,
  supportsSpecificChoice: true,
};

function emptySearch() {
  return tool(
    "search_web",
    vi.fn().mockResolvedValue({ ok: true, value: { results: [], diagnostics: {} } }),
  );
}

function searchRound(id: string, query: string): ChatResponseChunk[] {
  return [
    {
      content: "",
      isComplete: true,
      toolCalls: [{ id, name: "search_web", arguments: { query } }],
    },
  ];
}

describe("forced synthesis with note mutations available", () => {
  it("closes note mutation tools after two fruitless search rounds", async () => {
    const search = emptySearch();
    const create = tool(
      "create_note",
      vi.fn().mockResolvedValue({ ok: true, value: { ok: true } }),
    );
    const provider = new ScriptedProvider([
      searchRound("1", "a"),
      searchRound("2", "b"),
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "3", name: "create_note", arguments: { path: "A.md" } }],
        },
      ],
      [{ content: "created the note", isComplete: true }],
    ]);

    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const result = await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler, create.handler]),
      policy: OPEN_POLICY,
      onToolCall,
      onToolResult,
    }).run();

    expect(result).toMatchObject({ ok: true, answerText: "created the note" });
    expect(create.execute).not.toHaveBeenCalled();

    const synthesisRequest = provider.requests[2];
    expect(synthesisRequest.toolChoice).toEqual({ type: "none" });
    expect(synthesisRequest.tools?.map((entry) => entry.function.name)).toEqual([
      "search_web",
      "create_note",
    ]);
    expect(
      synthesisRequest.messages.some(
        (message) => message.role === "user" && /stop calling tools/i.test(String(message.content)),
      ),
    ).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ id: "3", status: "failed", reason: "synthesis-forced" }),
    );
    expect(onToolCall).toHaveBeenCalledWith("3", "create_note", "A", 3, { path: "A.md" });
    expect(onToolResult).toHaveBeenCalledWith(
      "3",
      false,
      undefined,
      undefined,
      expect.stringContaining("stop calling tools"),
    );
  });

  it("stubs every tool call emitted despite forced synthesis", async () => {
    const search = emptySearch();
    const create = tool(
      "create_note",
      vi.fn().mockResolvedValue({ ok: true, value: { ok: true } }),
    );
    const provider = new ScriptedProvider([
      searchRound("1", "a"),
      searchRound("2", "b"),
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [
            { id: "3", name: "create_note", arguments: { path: "A.md" } },
            { id: "4", name: "search_web", arguments: { query: "c" } },
          ],
        },
      ],
      [{ content: "done", isComplete: true }],
    ]);

    await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler, create.handler]),
      policy: OPEN_POLICY,
    }).run();

    expect(create.execute).not.toHaveBeenCalled();
    expect(search.execute).toHaveBeenCalledTimes(2);
  });

  it("closes every tool when no note mutation tool is registered", async () => {
    const search = emptySearch();
    const provider = new ScriptedProvider([
      searchRound("1", "a"),
      searchRound("2", "b"),
      [{ content: "no writes possible", isComplete: true }],
    ]);

    await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: OPEN_POLICY,
    }).run();

    expect(provider.requests[2].toolChoice).toEqual({ type: "none" });
  });
});

describe("search call budget", () => {
  it("reserves the budget while collecting parallel calls from one round", async () => {
    const search = emptySearch();
    const provider = new ScriptedProvider([
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [
            { id: "1", name: "search_web", arguments: { query: "a" } },
            { id: "2", name: "search_web", arguments: { query: "b" } },
          ],
        },
      ],
      [{ content: "final", isComplete: true }],
    ]);

    const result = await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: OPEN_POLICY,
      maxSearchCalls: 1,
    }).run();

    expect(search.execute).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ id: "2", reason: "search-budget-exhausted" }),
    );
  });

  it("rejects search calls beyond the budget without executing them", async () => {
    const search = emptySearch();
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const provider = new ScriptedProvider([
      searchRound("1", "a"),
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [
            { id: "2", name: "search_web", arguments: { query: "b" } },
            { id: "3", name: "search_web", arguments: { query: "c" } },
          ],
        },
      ],
      [{ content: "final", isComplete: true }],
    ]);

    const result = await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: OPEN_POLICY,
      maxSearchCalls: 2,
      onToolCall,
      onToolResult,
    }).run();

    expect(search.execute).toHaveBeenCalledTimes(2);
    const rejected = provider.requests[2].messages.filter(
      (message) =>
        message.role === "tool" && /search-budget-exhausted/.test(String(message.content)),
    );
    expect(rejected).toHaveLength(1);
    expect(onToolCall).toHaveBeenCalledWith("3", "search_web", "c", 2, { query: "c" });
    expect(onToolResult).toHaveBeenCalledWith(
      "3",
      false,
      undefined,
      undefined,
      expect.stringContaining("search-budget-exhausted"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        id: "3",
        status: "failed",
        reason: "search-budget-exhausted",
      }),
    );
    const rejectedDiagnostic = result.diagnostics.find((item) => item.id === "3");
    expect(rejectedDiagnostic?.resultBytes).toBeGreaterThan(0);
    expect(result.totalResultChars).toBeGreaterThanOrEqual(rejectedDiagnostic?.resultBytes ?? 0);
  });

  it("leaves searching unbounded when no budget is configured", async () => {
    const search = emptySearch();
    const provider = new ScriptedProvider([
      searchRound("1", "a"),
      searchRound("2", "b"),
      [{ content: "final", isComplete: true }],
    ]);

    await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: OPEN_POLICY,
    }).run();

    expect(search.execute).toHaveBeenCalledTimes(2);
  });
});

describe("exhausted search budget still reaches synthesis", () => {
  it("treats a round of only budget-rejected searches as no progress", async () => {
    const search = emptySearch();
    const create = tool(
      "create_note",
      vi.fn().mockResolvedValue({ ok: true, value: { ok: true } }),
    );
    const provider = new ScriptedProvider([
      searchRound("1", "a"),
      searchRound("2", "b"),
      searchRound("3", "c"),
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "4", name: "create_note", arguments: { path: "A.md" } }],
        },
      ],
      [{ content: "final", isComplete: true }],
    ]);

    await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler, create.handler]),
      policy: OPEN_POLICY,
      maxSearchCalls: 1,
    }).run();

    expect(search.execute).toHaveBeenCalledTimes(1);
    expect(create.execute).not.toHaveBeenCalled();
    expect(
      provider.requests[3].messages.some(
        (message) => message.role === "user" && /stop calling tools/i.test(String(message.content)),
      ),
    ).toBe(true);
    expect(provider.requests[3].toolChoice).toEqual({ type: "none" });
  });

  it("does not execute mutations after synthesis is forced", async () => {
    const search = emptySearch();
    const create = tool(
      "create_note",
      vi.fn().mockResolvedValue({ ok: true, value: { ok: true } }),
    );
    const mutationRound = (id: string): ChatResponseChunk[] => [
      {
        content: "",
        isComplete: true,
        toolCalls: [{ id, name: "create_note", arguments: { path: `${id}.md` } }],
      },
    ];
    const provider = new ScriptedProvider([
      searchRound("1", "a"),
      searchRound("2", "b"),
      mutationRound("3"),
      mutationRound("4"),
      mutationRound("5"),
      mutationRound("6"),
      [{ content: "final", isComplete: true }],
    ]);

    await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler, create.handler]),
      policy: OPEN_POLICY,
    }).run();

    expect(create.execute).not.toHaveBeenCalled();
  });

  it("charges index searches to the same budget as web searches", async () => {
    const indexSearch = tool(
      "search_index",
      vi.fn().mockResolvedValue({ ok: true, value: { results: [] } }),
    );
    const provider = new ScriptedProvider([
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "1", name: "search_index", arguments: { query: "a" } }],
        },
      ],
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "2", name: "search_index", arguments: { query: "b" } }],
        },
      ],
      [{ content: "final", isComplete: true }],
    ]);

    await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([indexSearch.handler]),
      policy: OPEN_POLICY,
      maxSearchCalls: 1,
    }).run();

    expect(indexSearch.execute).toHaveBeenCalledTimes(1);
  });
});

describe("search_web call cache", () => {
  it("treats query and queries forms of the same search as one call", async () => {
    const search = emptySearch();
    const provider = new ScriptedProvider([
      searchRound("1", "a"),
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "2", name: "search_web", arguments: { queries: ["a"] } }],
        },
      ],
      [{ content: "final", isComplete: true }],
    ]);

    await new ThinkingResearchRunner({
      modelRound: new ChatCompletionsRoundAdapter(provider),
      model: "m",
      messages: [],
      tools: new ToolManager([search.handler]),
      policy: OPEN_POLICY,
    }).run();

    expect(search.execute).toHaveBeenCalledTimes(1);
  });
});
