import { describe, expect, it } from "vitest";

import {
  parseOpenAiChatDelta,
  textFromEvents,
  ToolCallBuilder,
} from "@adapters/model-provider/chat/streaming/chatStreamPrimitives";

describe("ToolCallBuilder", () => {
  it("assembles interleaved deltas in index order and ignores nameless calls", () => {
    const builder = new ToolCallBuilder();
    builder.add({ index: 1, id: "second", name: "search", argumentsText: '{"q":' });
    builder.add({
      index: 0,
      id: "first",
      name: "fetch",
      argumentsText: '{"url":"https://a.test"}',
    });
    builder.add({ index: 1, argumentsText: '"vault"}' });
    builder.add({ index: 2, argumentsText: "unused" });

    expect(builder.build()).toEqual([
      { id: "first", name: "fetch", arguments: { url: "https://a.test" } },
      { id: "second", name: "search", arguments: { q: "vault" } },
    ]);
  });

  it("uses fallback ids and preserves malformed JSON for a tool to handle", () => {
    const builder = new ToolCallBuilder();
    builder.add({ name: "search", argumentsText: "not json" });
    builder.add({ name: "empty" });

    expect(builder.build()).toEqual([
      { id: "call_0", name: "search", arguments: { raw: "not json" } },
      { id: "call_1", name: "empty", arguments: {} },
    ]);
  });
});

describe("parseOpenAiChatDelta", () => {
  it("returns an empty delta for malformed provider events", () => {
    expect(parseOpenAiChatDelta(null)).toMatchObject({
      content: "",
      reasoning: "",
      toolCallDeltas: [],
    });
    expect(parseOpenAiChatDelta({ choices: [{}] })).toMatchObject({ toolCallDeltas: [] });
  });

  it("prefers visible reasoning details and records summary visibility", () => {
    const parsed = parseOpenAiChatDelta({
      choices: [
        {
          finish_reason: "tool_calls",
          delta: {
            content: "Answer",
            reasoning: "fallback reasoning",
            reasoning_details: [
              { type: "reasoning.summary", text: "Plan: " },
              { type: "summary", content: "search notes" },
            ],
            tool_calls: [
              { index: 3, id: "call", function: { name: "search", arguments: '{"q"' } },
              { function: {} },
            ],
          },
        },
      ],
    });

    expect(parsed).toEqual({
      content: "Answer",
      reasoning: "Plan: search notes",
      reasoningDialect: "reasoning_details",
      reasoningVisibility: "summary",
      finishReason: "tool_calls",
      toolCallDeltas: [{ index: 3, id: "call", name: "search", argumentsText: '{"q"' }, {}],
    });
  });

  it("reads vendor reasoning fields when details are absent", () => {
    expect(
      parseOpenAiChatDelta({ choices: [{ delta: { reasoning_content: "Thinking" } }] }),
    ).toMatchObject({
      reasoning: "Thinking",
      reasoningDialect: "reasoning_content",
      reasoningVisibility: "text",
    });
  });
});

describe("textFromEvents", () => {
  it("joins only text stream events", () => {
    expect(
      textFromEvents([
        { type: "text-delta", text: "Hello" },
        { type: "reasoning-delta", segmentId: "thought_1", text: "ignored" },
        { type: "text-delta", text: " world" },
      ]),
    ).toBe("Hello world");
  });
});
