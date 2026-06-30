import type { ChatRequest, ModelRoundProvider, ModelRoundResult } from "../../src/core/agent/protocol";
import type { ChatToolChoice, ToolCallingCapabilities } from "../../src/core/agent/tool";
import { ChatCompletionsRoundAdapter } from "../../src/adapters/model-provider/chat/rounds/ChatCompletionsRoundAdapter";

describe("future model-round contracts", () => {
  it("represents provider-neutral tool choice and ordered output without changing ChatRequest", () => {
    const choices: ChatToolChoice[] = [
      { type: "auto" },
      { type: "none" },
      { type: "required" },
      { type: "specific", name: "search_index" },
    ];
    const tools: ToolCallingCapabilities = {
      calls: true,
      choiceRequired: false,
      choiceSpecific: false,
      parallelCalls: true,
    };
    const round: ModelRoundResult = {
      items: [
        { type: "text", text: "Checking sources." },
        { type: "reasoningSummary", text: "Source selection" },
        {
          type: "toolCall",
          call: { id: "call-1", name: "search_index", arguments: { query: "tool loops" } },
        },
      ],
      stopReason: "tool_calls",
    };
    const liveRequest: ChatRequest = { model: "existing-model", messages: [] };

    expect(choices.map((choice) => choice.type)).toEqual(["auto", "none", "required", "specific"]);
    expect(tools.parallelCalls).toBe(true);
    expect(round.items.map((item) => item.type)).toEqual(["text", "reasoningSummary", "toolCall"]);
    expect("toolChoice" in liveRequest).toBe(false);
  });

  it("adapts current chat streams without inventing continuation", async () => {
    const chatModel = {
      listModels: async () => ["model"],
      async *streamChat() {
        yield { content: "Hello", isComplete: false };
        yield {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "call-1", name: "search_index", arguments: { query: "x" } }],
        };
      },
    };
    const provider: ModelRoundProvider = new ChatCompletionsRoundAdapter(chatModel);
    const result = await provider.runRound({ model: "model", messages: [] });

    expect(result).toEqual({
      items: [
        { type: "text", text: "Hello" },
        {
          type: "toolCall",
          call: { id: "call-1", name: "search_index", arguments: { query: "x" } },
        },
      ],
      stopReason: "tool_calls",
    });
    expect(result.continuation).toBeUndefined();
  });

  it("propagates normalized reasoning events without mixing them into text", async () => {
    const chatModel = {
      listModels: async () => ["model"],
      async *streamChat() {
        yield {
          content: "",
          isComplete: false,
          events: [
            { type: "reasoning-start" as const, segmentId: "r1", visibility: "summary" as const },
            { type: "reasoning-delta" as const, segmentId: "r1", text: "Plan" },
          ],
        };
        yield {
          content: "Answer",
          isComplete: true,
          events: [
            { type: "reasoning-end" as const, segmentId: "r1" },
            { type: "text-delta" as const, text: "Answer" },
            { type: "complete" as const, stopReason: "complete" as const },
          ],
        };
      },
    };
    const events: string[] = [];
    const provider = new ChatCompletionsRoundAdapter(chatModel);
    const result = await provider.runRound({
      model: "model",
      messages: [],
      onEvent: (event) => events.push(event.type),
    });

    expect(events).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-delta",
      "complete",
    ]);
    expect(result.items).toEqual([
      { type: "reasoningSummary", text: "Plan" },
      { type: "text", text: "Answer" },
    ]);
  });
});
