const LEAKED_TOOL_CALL_MARKUP =
  /<\|?\s*(?:tool_calls?|function_calls?|(?:antml:)?invoke|tool_call)\b|\binvoke\s+name\s*=/i;

export function looksLikeLeakedToolCall(text: string): boolean {
  return LEAKED_TOOL_CALL_MARKUP.test(text.slice(0, 4_000));
}
