import { describe, expect, it } from "vitest";
import { parseTextToolCalls } from "@adapters/model-provider/chat/streaming/textToolCalls";
import { ChatToolDefinition } from "@core/agent";

const tools: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_notes",
      description: "",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description: "",
      parameters: { type: "object", properties: {} },
    },
  },
];

describe("parseTextToolCalls", () => {
  it("recovers the namespaced wrapped function-call syntax leaked by gemma", () => {
    const calls = parseTextToolCalls(
      '<|tool_call>call:attest.list_notes(path="")<tool_call|>',
      tools,
    );
    expect(calls).toEqual([{ id: "text_call_0", name: "list_notes", arguments: { path: "" } }]);
  });

  it("parses keyword arguments with mixed scalar types", () => {
    const calls = parseTextToolCalls('list_notes(prefix="Daily", limit=5)', tools);
    expect(calls).toEqual([
      { id: "text_call_0", name: "list_notes", arguments: { prefix: "Daily", limit: 5 } },
    ]);
  });

  it("parses the <tool_call> JSON form and strips the namespace", () => {
    const text =
      '<tool_call>{"name": "functions.read_note", "arguments": {"path": "a.md"}}</tool_call>';
    expect(parseTextToolCalls(text, tools)).toEqual([
      { id: "text_call_0", name: "read_note", arguments: { path: "a.md" } },
    ]);
  });

  it("parses a JSON object passed positionally inside parens", () => {
    expect(parseTextToolCalls('read_note({"path": "b.md"})', tools)).toEqual([
      { id: "text_call_0", name: "read_note", arguments: { path: "b.md" } },
    ]);
  });

  it("ignores prose that merely mentions a tool name", () => {
    expect(parseTextToolCalls("I should use the list_notes tool to help.", tools)).toEqual([]);
  });

  it("ignores calls to unknown tools", () => {
    expect(parseTextToolCalls('delete_everything(path="x")', tools)).toEqual([]);
  });

  it("returns nothing when no tools are offered", () => {
    expect(parseTextToolCalls('list_notes(path="")', [])).toEqual([]);
  });

  it("prefers JSON form and parses multiple JSON tool calls", () => {
    const text =
      '{"name":"list_notes","arguments":{}} then {"name":"read_note","arguments":{"path":"c.md"}}';
    expect(parseTextToolCalls(text, tools)).toEqual([
      { id: "text_call_0", name: "list_notes", arguments: {} },
      { id: "text_call_1", name: "read_note", arguments: { path: "c.md" } },
    ]);
  });
});
