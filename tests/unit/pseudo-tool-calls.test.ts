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
      text: "Searching now.\n\nThen  done.",
      toolNames: ["search_web", "list_notes"],
    });
  });

  it("removes tool_code fences and bare call objects but keeps other fences and inline code", () => {
    const text = [
      "Lead.",
      "```tool_code",
      'read_note(path="a.md")',
      "```",
      '{"name": "fetch_web_page", "arguments": {"url": "https://a.b"}}',
      "```json",
      '{"name": "run_subagent", "arguments": {}}',
      "```",
      'Inline `<tool_call>{"name":"read_note"}</tool_call>` stays.',
    ].join("\n");

    expect(strip(text)).toEqual({
      text: [
        "Lead.",
        "",
        "```json",
        '{"name": "run_subagent", "arguments": {}}',
        "```",
        'Inline `<tool_call>{"name":"read_note"}</tool_call>` stays.',
      ].join("\n"),
      toolNames: ["read_note", "fetch_web_page"],
    });
  });

  it("leaves unknown names, plain HTML and prose mentions untouched", () => {
    const text = [
      "Use <tool>, <tool_read_note attr> or <tool_weather>sunny</tool_weather> here.",
      '<tool_call>{"name": "get_weather"}</tool_call>',
      '{"name": "Kansas", "arguments": {}}',
      "Then call run_subagent(task) yourself.",
    ].join("\n");

    expect(strip(text)).toEqual({ text, toolNames: [] });
  });

  it("drops an unclosed known tag to the end and a stray known closing tag", () => {
    expect(strip('Before </tool_wait_subagents> mid <tool_map_sources> {"q": 1}')).toEqual({
      text: "Before  mid",
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
