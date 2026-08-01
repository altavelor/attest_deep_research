import { isRecord } from "@shared";
import { ChatToolCall, ModelStreamEvent } from "@core/agent";

export interface ToolCallDelta {
  index?: number;
  id?: string;
  name?: string;
  argumentsText?: string;
}

export class ToolCallBuilder {
  private readonly items = new Map<number, { id?: string; name?: string; argumentsText: string }>();
  private nextIndex = 0;

  add(delta: ToolCallDelta): void {
    const index = delta.index ?? this.nextIndex++;
    const current = this.items.get(index) ?? { argumentsText: "" };
    this.items.set(index, {
      id: delta.id ?? current.id,
      name: delta.name ?? current.name,
      argumentsText: `${current.argumentsText}${delta.argumentsText ?? ""}`,
    });
  }

  build(): ChatToolCall[] {
    return [...this.items.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, item]) => ({
        id: item.id ?? `call_${index}`,
        name: item.name ?? "",
        arguments: parseToolArguments(item.argumentsText),
      }))
      .filter((item) => item.name.length > 0);
  }
}

export function parseOpenAiChatDelta(chunk: unknown): {
  content: string;
  reasoning: string;
  reasoningDialect: string;
  reasoningVisibility: "text" | "summary";
  toolCallDeltas: ToolCallDelta[];
  finishReason?: string;
} {
  const empty = {
    content: "",
    reasoning: "",
    reasoningDialect: "",
    reasoningVisibility: "text" as const,
    toolCallDeltas: [],
  };
  if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return empty;
  const choice: unknown = chunk.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) return empty;
  const reasoning = readReasoningDelta(choice.delta);
  return {
    content: typeof choice.delta.content === "string" ? choice.delta.content : "",
    reasoning: reasoning.text,
    reasoningDialect: reasoning.dialect,
    reasoningVisibility: reasoning.visibility,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : undefined,
    toolCallDeltas: parseOpenAiToolCallDeltas(choice.delta.tool_calls),
  };
}

export function textFromEvents(events: ModelStreamEvent[]): string {
  return events
    .filter(
      (event): event is Extract<ModelStreamEvent, { type: "text-delta" }> =>
        event.type === "text-delta",
    )
    .map((event) => event.text)
    .join("");
}

function readReasoningDelta(delta: Record<string, unknown>): {
  text: string;
  dialect: string;
  visibility: "text" | "summary";
} {
  const details = visibleReasoningDetails(delta.reasoning_details);
  if (details) return { ...details, dialect: "reasoning_details" };
  for (const key of ["reasoning", "reasoning_content", "thinking"] as const)
    if (typeof delta[key] === "string" && delta[key])
      return { text: delta[key], visibility: "text", dialect: key };
  return { text: "", visibility: "text", dialect: "" };
}
function visibleReasoningDetails(
  value: unknown,
): { text: string; visibility: "text" | "summary" } | undefined {
  const visible: Array<{ text: string; visibility: "text" | "summary" }> = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    if (typeof item === "string" && item) {
      visible.push({ text: item, visibility: "text" });
      continue;
    }
    if (!isRecord(item)) continue;
    const text =
      typeof item.text === "string"
        ? item.text
        : typeof item.content === "string"
          ? item.content
          : "";
    if (text)
      visible.push({
        text,
        visibility:
          item.type === "reasoning.summary" || item.type === "summary" ? "summary" : "text",
      });
  }
  return visible.length
    ? {
        text: visible.map((item) => item.text).join(""),
        visibility: visible.every((item) => item.visibility === "summary") ? "summary" : "text",
      }
    : undefined;
}
function parseOpenAiToolCallDeltas(value: unknown): ToolCallDelta[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((toolCall) => ({
        index: typeof toolCall.index === "number" ? toolCall.index : undefined,
        id: typeof toolCall.id === "string" ? toolCall.id : undefined,
        name:
          isRecord(toolCall.function) && typeof toolCall.function.name === "string"
            ? toolCall.function.name
            : undefined,
        argumentsText:
          isRecord(toolCall.function) && typeof toolCall.function.arguments === "string"
            ? toolCall.function.arguments
            : undefined,
      }))
    : [];
}
function parseToolArguments(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return { raw: value };
  }
}
