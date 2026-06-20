import type {
  ChatRequest,
  ChatToolChoice,
  ModelRoundResult,
  ReasoningCapabilities,
  ToolCallingCapabilities,
} from "../../src/shared/types";

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
    const reasoning: ReasoningCapabilities = {
      enabled: true,
      continuation: true,
      summary: false,
    };
    const round: ModelRoundResult = {
      items: [
        { type: "text", text: "Checking sources." },
        { type: "reasoning", providerData: { opaque: true }, summary: "Source selection" },
        {
          type: "toolCall",
          call: { id: "call-1", name: "search_index", arguments: { query: "tool loops" } },
        },
      ],
      continuation: { provider: "openai-compatible", opaque: { responseId: "resp-1" } },
      stopReason: "tool_calls",
    };
    const liveRequest: ChatRequest = { model: "existing-model", messages: [] };

    expect(choices.map((choice) => choice.type)).toEqual(["auto", "none", "required", "specific"]);
    expect(tools.parallelCalls).toBe(true);
    expect(reasoning.continuation).toBe(true);
    expect(round.items.map((item) => item.type)).toEqual(["text", "reasoning", "toolCall"]);
    expect("toolChoice" in liveRequest).toBe(false);
  });
});
