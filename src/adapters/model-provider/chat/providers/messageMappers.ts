import { ChatMessage } from "@core/agent";

export function mapOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      })),
    };
  }
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
  }
  return { role: message.role, content: message.content };
}

export function mapOllamaMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((toolCall) => ({
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })),
    };
  }
  if (message.role === "tool") {
    return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
  }
  return { role: message.role, content: message.content };
}

export function mapAnthropicMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  const mapped: Record<string, unknown>[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "tool") {
      mapped.push(mapAnthropicMessage(message));
      continue;
    }
    const content: Record<string, unknown>[] = [];
    while (index < messages.length && messages[index].role === "tool") {
      const tool = messages[index];
      content.push({
        type: "tool_result",
        tool_use_id: tool.toolCallId,
        content: tool.content,
      });
      index += 1;
    }
    index -= 1;
    mapped.push({ role: "user", content });
  }
  return mapped;
}

function mapAnthropicMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: [
        ...(message.content ? [{ type: "text", text: message.content }] : []),
        ...message.toolCalls.map((toolCall) => ({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments,
        })),
      ],
    };
  }
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
        },
      ],
    };
  }
  return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
}
