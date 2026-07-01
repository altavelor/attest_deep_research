// Tool-call markup some models emit as plain text when their function-call dialect is not
// parsed into structured calls (harmony `<|tool_calls|>`/`<|invoke>`, Anthropic-style
// `<invoke name=…>`, Hermes `<tool_call>`). Such text is never a real answer — treating it
// as the sub-agent's final answer would leak raw markup to the parent.

const LEAKED_TOOL_CALL_MARKUP =
  /<\|?\s*(?:tool_calls?|function_calls?|(?:antml:)?invoke|tool_call)\b|\binvoke\s+name\s*=/i;

export function looksLikeLeakedToolCall(text: string): boolean {
  return LEAKED_TOOL_CALL_MARKUP.test(text.slice(0, 4_000));
}
