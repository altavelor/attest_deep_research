import type { ChatMessage, ModelOutputItem } from "@core/agent";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import { mapOpenAiMessage } from "@adapters/model-provider/chat/providers/messageMappers";

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

describe("part types the mappers do not model", () => {
  const emptyParts: ChatMessage[] = [
    { role: "assistant", content: "" },
    { role: "assistant", content: "", toolCalls: [] },
    { role: "tool", content: "", toolCallId: "" },
    { role: "user", content: "" },
  ];

  it("keeps empty parts addressable instead of dropping the turn", () => {
    expect(emptyParts.map(mapOpenAiMessage)).toHaveLength(4);
  });

  it("ignores unknown fields on a message rather than forwarding them to the provider", () => {
    const withUnknownPart = {
      role: "assistant",
      content: "text",
      reasoning: "hidden chain of thought",
      parts: [{ type: "image", url: "https://example.org/a.png" }],
      toolCalls: [{ id: "call-1", name: "noop", arguments: {} }],
    } as unknown as ChatMessage;

    const serialized = JSON.stringify(mapOpenAiMessage(withUnknownPart));
    expect(serialized).not.toContain("hidden chain of thought");
    expect(serialized).not.toContain("example.org");
    expect(serialized).toContain("noop");
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

    const serialized = JSON.stringify(mapOpenAiMessage(assistant));
    expect(serialized).not.toContain("Secret plan");
    expect(serialized).not.toContain("reasoning");
    expect(serialized).not.toContain("thinking");
    expect(serialized).toContain("Checking sources.");
    expect(serialized).toContain("search_index");
  });
});
