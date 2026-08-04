import type { ChatMessage, ModelOutputItem } from "@core/agent";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import {
  mapAnthropicMessages,
  mapOllamaMessage,
  mapOpenAiMessage,
} from "@adapters/model-provider/chat/providers/messageMappers";

const conversation: ChatMessage[] = [
  { role: "system", content: "You are a research agent." },
  { role: "user", content: "Which notes mention tool loops?" },
  {
    role: "assistant",
    content: "Searching the index.",
    toolCalls: [
      { id: "call-1", name: "search_index", arguments: { query: "tool loops", limit: 2 } },
      { id: "call-2", name: "search_index", arguments: { query: "agent loop" } },
    ],
  },
  { role: "tool", content: '{"results":[]}', toolCallId: "call-1" },
  { role: "tool", content: '{"results":["a"]}', toolCallId: "call-2" },
  { role: "assistant", content: "Nothing relevant." },
];

describe("OpenAI message mapping", () => {
  it("round-trips tool calls with JSON-encoded arguments", () => {
    const mapped = conversation.map(mapOpenAiMessage);
    const assistant = mapped[2] as {
      tool_calls: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };

    expect(assistant.tool_calls.map((call) => call.id)).toEqual(["call-1", "call-2"]);
    expect(assistant.tool_calls.every((call) => call.type === "function")).toBe(true);
    expect(
      assistant.tool_calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments) as unknown,
      })),
    ).toEqual(conversation[2]!.toolCalls);

    expect(mapped[3]).toEqual({
      role: "tool",
      content: '{"results":[]}',
      tool_call_id: "call-1",
    });
    expect(mapped[0]).toEqual({ role: "system", content: "You are a research agent." });
  });

  it("sends null content for a tool-only assistant turn and keeps an empty tool list plain", () => {
    expect(
      mapOpenAiMessage({
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "noop", arguments: {} }],
      }),
    ).toMatchObject({ content: null });

    expect(mapOpenAiMessage({ role: "assistant", content: "", toolCalls: [] })).toEqual({
      role: "assistant",
      content: "",
    });
  });

  it("passes a tool result without a call id through without inventing one", () => {
    expect(mapOpenAiMessage({ role: "tool", content: "{}" })).toEqual({
      role: "tool",
      content: "{}",
      tool_call_id: undefined,
    });
  });
});

describe("Ollama message mapping", () => {
  it("round-trips tool calls with structured arguments and no call id", () => {
    const mapped = conversation.map(mapOllamaMessage);
    const assistant = mapped[2] as {
      content: string;
      tool_calls: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
    };

    expect(assistant.content).toBe("Searching the index.");
    expect(assistant.tool_calls.map((call) => call.function)).toEqual([
      { name: "search_index", arguments: { query: "tool loops", limit: 2 } },
      { name: "search_index", arguments: { query: "agent loop" } },
    ]);
    expect(mapped[4]).toEqual({
      role: "tool",
      content: '{"results":["a"]}',
      tool_call_id: "call-2",
    });
  });

  it("keeps empty assistant content as a string rather than null", () => {
    expect(
      mapOllamaMessage({
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "noop", arguments: {} }],
      }),
    ).toMatchObject({ content: "" });
  });
});

describe("Anthropic message mapping", () => {
  it("round-trips tool calls as multi-part content and merges consecutive results", () => {
    const mapped = mapAnthropicMessages(conversation);

    expect(mapped.map((message) => message.role)).toEqual([
      "user",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    const assistant = mapped[2] as { content: Array<Record<string, unknown>> };
    expect(assistant.content[0]).toEqual({ type: "text", text: "Searching the index." });
    expect(assistant.content.slice(1)).toEqual([
      {
        type: "tool_use",
        id: "call-1",
        name: "search_index",
        input: { query: "tool loops", limit: 2 },
      },
      { type: "tool_use", id: "call-2", name: "search_index", input: { query: "agent loop" } },
    ]);

    const results = mapped[3] as { content: Array<Record<string, unknown>> };
    expect(results.content).toEqual([
      { type: "tool_result", tool_use_id: "call-1", content: '{"results":[]}' },
      { type: "tool_result", tool_use_id: "call-2", content: '{"results":["a"]}' },
    ]);
  });

  it("omits the text part when a tool-calling turn carries no text", () => {
    const [mapped] = mapAnthropicMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "noop", arguments: {} }],
      },
    ]);
    const content = (mapped as { content: Array<Record<string, unknown>> }).content;

    expect(content).toEqual([{ type: "tool_use", id: "call-1", name: "noop", input: {} }]);
  });

  it("maps a trailing tool result and an empty conversation without losing turns", () => {
    expect(mapAnthropicMessages([])).toEqual([]);

    expect(mapAnthropicMessages([{ role: "tool", content: "late", toolCallId: "call-9" }])).toEqual(
      [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call-9", content: "late" }],
        },
      ],
    );
  });

  it("treats an unknown role as a user turn instead of forwarding it verbatim", () => {
    const unknown = { role: "developer", content: "hidden" } as unknown as ChatMessage;

    expect(mapAnthropicMessages([unknown])).toEqual([{ role: "user", content: "hidden" }]);
  });

  it("keeps every tool result of a multi-part turn and reopens an assistant turn after it", () => {
    const interleaved: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-1", name: "a", arguments: {} },
          { id: "call-2", name: "b", arguments: { x: 1 } },
          { id: "call-3", name: "c", arguments: { y: [1, 2] } },
        ],
      },
      { role: "tool", content: "r1", toolCallId: "call-1" },
      { role: "tool", content: "r2", toolCallId: "call-2" },
      { role: "tool", content: "r3", toolCallId: "call-3" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "Thanks." },
    ];

    const mapped = mapAnthropicMessages(interleaved);

    expect(mapped.map((message) => message.role)).toEqual([
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect((mapped[1] as { content: unknown[] }).content).toHaveLength(3);
    expect((mapped[0] as { content: unknown[] }).content).toHaveLength(3);
    expect(mapped[2]).toEqual({ role: "assistant", content: "Done." });
  });
});

describe("part types the mappers do not model", () => {
  const emptyParts: ChatMessage[] = [
    { role: "assistant", content: "" },
    { role: "assistant", content: "", toolCalls: [] },
    { role: "tool", content: "", toolCallId: "" },
    { role: "user", content: "" },
  ];

  it("keeps empty parts addressable instead of dropping the turn", () => {
    expect(emptyParts.map(mapOpenAiMessage)).toHaveLength(4);
    expect(emptyParts.map(mapOllamaMessage)).toHaveLength(4);
    expect(mapAnthropicMessages(emptyParts)).toHaveLength(4);

    expect(mapAnthropicMessages([{ role: "assistant", content: "", toolCalls: [] }])).toEqual([
      { role: "assistant", content: "" },
    ]);
  });

  it("ignores unknown fields on a message rather than forwarding them to the provider", () => {
    const withUnknownPart = {
      role: "assistant",
      content: "text",
      reasoning: "hidden chain of thought",
      parts: [{ type: "image", url: "https://example.org/a.png" }],
      toolCalls: [{ id: "call-1", name: "noop", arguments: {} }],
    } as unknown as ChatMessage;

    for (const mapped of [
      mapOpenAiMessage(withUnknownPart),
      mapOllamaMessage(withUnknownPart),
      ...mapAnthropicMessages([withUnknownPart]),
    ]) {
      const serialized = JSON.stringify(mapped);
      expect(serialized).not.toContain("hidden chain of thought");
      expect(serialized).not.toContain("example.org");
      expect(serialized).toContain("noop");
    }
  });

  it("passes an unknown tool-call argument shape through without reinterpreting it", () => {
    const message: ChatMessage = {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "call-1", name: "odd", arguments: { nested: { list: [1, null] }, flag: false } },
      ],
    };

    const openAi = mapOpenAiMessage(message) as {
      tool_calls: Array<{ function: { arguments: string } }>;
    };
    expect(JSON.parse(openAi.tool_calls[0]!.function.arguments)).toEqual(
      message.toolCalls![0]!.arguments,
    );

    const ollama = mapOllamaMessage(message) as {
      tool_calls: Array<{ function: { arguments: Record<string, unknown> } }>;
    };
    expect(ollama.tool_calls[0]!.function.arguments).toEqual(message.toolCalls![0]!.arguments);

    const anthropic = mapAnthropicMessages([message])[0] as {
      content: Array<{ input?: Record<string, unknown> }>;
    };
    expect(anthropic.content[0]!.input).toEqual(message.toolCalls![0]!.arguments);
  });
});

describe("reasoning parts across the round trip", () => {
  async function runRound(): Promise<ModelOutputItem[]> {
    const chatModel = {
      listModels: async () => ["model"],
      async *streamChat() {
        yield {
          content: "",
          isComplete: false,
          events: [
            { type: "reasoning-start" as const, segmentId: "r1", visibility: "summary" as const },
            { type: "reasoning-delta" as const, segmentId: "r1", text: "Secret plan" },
            { type: "reasoning-end" as const, segmentId: "r1" },
          ],
        };
        yield {
          content: "Checking sources.",
          isComplete: true,
          toolCalls: [{ id: "call-1", name: "search_index", arguments: { query: "x" } }],
        };
      },
    };
    const result = await new ChatCompletionsRoundAdapter(chatModel).runRound({
      model: "model",
      messages: [],
    });
    return result.items;
  }

  it("surfaces reasoning as a separate item that never reaches a provider request", async () => {
    const items = await runRound();

    expect(items.map((item) => item.type)).toEqual(["reasoningSummary", "text", "toolCall"]);

    const assistant: ChatMessage = {
      role: "assistant",
      content: items
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join(""),
      toolCalls: items.filter((item) => item.type === "toolCall").map((item) => item.call),
    };

    for (const mapped of [
      mapOpenAiMessage(assistant),
      mapOllamaMessage(assistant),
      ...mapAnthropicMessages([assistant]),
    ]) {
      const serialized = JSON.stringify(mapped);
      expect(serialized).not.toContain("Secret plan");
      expect(serialized).not.toContain("reasoning");
      expect(serialized).not.toContain("thinking");
      expect(serialized).toContain("Checking sources.");
      expect(serialized).toContain("search_index");
    }
  });
});
