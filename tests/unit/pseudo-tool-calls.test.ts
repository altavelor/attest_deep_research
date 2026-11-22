import { CATALOGUE_TOOL_NAMES } from "@core/agent";
import { PSEUDO_TOOL_SCAN_LIMIT, stripPseudoToolCalls } from "@core/research";

const strip = (text: string) => stripPseudoToolCalls(text, CATALOGUE_TOOL_NAMES);

const SCREENSHOT_MARKUP = [
  "<tool_run_subagent>",
  "Find the current weather in Kansas",
  "[]",
  "6",
  "</tool_run_subagent>",
  "<tool_wait_subagents>",
  "30000",
  "</tool_wait_subagents>",
].join("\n");

describe("stripPseudoToolCalls", () => {
  it("removes the <tool_NAME> blocks of the reported answer and keeps the lead sentence", () => {
    expect(strip(`Запускаю агента для поиска погоды в Канзасе.\n${SCREENSHOT_MARKUP}`)).toEqual({
      text: "Запускаю агента для поиска погоды в Канзасе.",
      toolNames: ["run_subagent", "wait_subagents"],
    });
  });

  it("removes <tool_call> blocks in JSON, closing-tag and repeated-opening forms", () => {
    const text = [
      "Searching now.",
      "",
      '<tool_call>{"name": "search_web", "arguments": {"query": "x"}}</tool_call>',
      "",
      'Then <tool_call>call:attest.list_notes(path="")<tool_call> done.',
    ].join("\n");

    expect(strip(text)).toEqual({
      text: "Searching now.\n\nThen done.",
      toolNames: ["search_web", "list_notes"],
    });
  });

  it("removes call fences and bare call objects but keeps other code and text byte-identical", () => {
    const kept = [
      "```json",
      '{"name": "run_subagent", "arguments": {}}  ',
      "",
      "",
      "",
      "```",
      'Inline `<tool_call>{"name":"read_note"}</tool_call>` stays.',
    ].join("\n");
    const text = [
      "Lead with a hard break  ",
      "next.",
      "```tool_code",
      'read_note(path="a.md")',
      "```",
      "```tool_call",
      'search_notes(query="k")',
      "```",
      '{"name": "fetch_web_page", "arguments": {"url": "https://a.b"}}',
      '{"tool": "list_notes", "args": {}}',
      kept,
    ].join("\n");

    expect(strip(text)).toEqual({
      text: `Lead with a hard break  \nnext.\n\n${kept}`,
      toolNames: ["read_note", "search_notes", "fetch_web_page", "list_notes"],
    });
  });

  it("leaves unknown names, plain HTML and prose mentions untouched", () => {
    const text = [
      "Use <tool>, <tool_read_note attr> or <tool_weather>sunny</tool_weather> here.",
      '<tool_call>{"name": "get_weather"}</tool_call>',
      '{"name": "Kansas", "arguments": {}}',
      "Then call run_subagent(task) yourself.",
      'Schema {"name": "run_subagent", "description": "delegate"} only.',
      "a <tool_run_subagent foo=1>x</tool_run_subagent> b",
    ].join("\n");

    expect(strip(text)).toEqual({ text, toolNames: [] });
  });

  it("drops a closing tag only after a removed call and an unclosed tag only to the blank line", () => {
    const text =
      "<tool_wait_subagents>30000</tool_wait_subagents></tool_wait_subagents>\nBefore " +
      "<tool_map_sources> is the tag\n\nLong real answer.";

    expect(strip(text)).toEqual({
      text: "Before\n\nLong real answer.",
      toolNames: ["wait_subagents", "map_sources"],
    });
  });

  it("scans a hostile input at the size cap in bounded time and skips larger input", () => {
    const unit = '<tool_call>{"name":`{"name":<tool_run_subagent ```\n';
    const hostile = unit.repeat(Math.floor(PSEUDO_TOOL_SCAN_LIMIT / unit.length));
    expect(strip(hostile).text.length).toBeLessThanOrEqual(hostile.length);

    const oversized = `${"x".repeat(PSEUDO_TOOL_SCAN_LIMIT)}<tool_run_subagent>a</tool_run_subagent>`;
    expect(strip(oversized)).toEqual({ text: oversized, toolNames: [] });
  });
});
