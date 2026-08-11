import type Anthropic from "@anthropic-ai/sdk";

import { ChatRequest, ChatResponseChunk, ModelStreamEvent } from "@core/agent";
import { AttestError } from "@core/errors";
import { mapAnthropicMessages } from "../providers/messageMappers";
import { textFromEvents, ToolCallBuilder } from "./chatStreamPrimitives";

interface AnthropicChatStreamOptions {
  anthropic: Anthropic;
  request: ChatRequest;
  translateError(error: unknown): AttestError;
}

export async function* streamAnthropicChat({
  anthropic,
  request,
  translateError,
}: AnthropicChatStreamOptions): AsyncIterable<ChatResponseChunk> {
  const systemMessage = request.messages.find((message) => message.role === "system")?.content;
  const messages = request.messages.filter((message) => message.role !== "system");
  const tools =
    request.tools && request.tools.length > 0
      ? request.tools.map((tool) => ({
          name: tool.function.name,
          ...(tool.function.description ? { description: tool.function.description } : {}),
          input_schema: tool.function.parameters as Anthropic.Tool["input_schema"],
        }))
      : undefined;
  const body = {
    model: request.model,
    messages: mapAnthropicMessages(messages) as unknown as Anthropic.MessageParam[],
    max_tokens: request.maxTokens ?? 4096,
    stream: true,
    ...(systemMessage ? { system: systemMessage } : {}),
    ...(tools ? { tools, tool_choice: mapAnthropicToolChoice(request) } : {}),
    ...(request.reasoningEnabled
      ? {
          thinking: { type: "adaptive" as const, display: "summarized" as const },
          ...(request.reasoningEffort
            ? {
                output_config: {
                  effort: request.reasoningEffort as NonNullable<Anthropic.OutputConfig["effort"]>,
                },
              }
            : {}),
        }
      : request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
  } satisfies Anthropic.MessageCreateParamsStreaming;

  let stream: AsyncIterable<Anthropic.RawMessageStreamEvent>;
  try {
    stream = await anthropic.messages.create(body, { signal: request.signal });
  } catch (error) {
    throw translateError(error);
  }

  const toolCallBuilder = new ToolCallBuilder();
  const reasoningSegmentId = "reasoning-0";
  let reasoningOpen = false;
  let terminalStopReason: "complete" | "length" | "error" | "tool_calls" = "complete";

  try {
    for await (const event of stream) {
      const events: ModelStreamEvent[] = [];
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        toolCallBuilder.add({
          index: event.index,
          id: event.content_block.id,
          name: event.content_block.name,
        });
        events.push({
          type: "tool-call-delta",
          index: event.index,
          id: event.content_block.id,
          name: event.content_block.name,
        });
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "thinking_delta") {
          if (!reasoningOpen) {
            reasoningOpen = true;
            events.push({
              type: "reasoning-start",
              segmentId: reasoningSegmentId,
              visibility: "text",
            });
          }
          events.push({
            type: "reasoning-delta",
            segmentId: reasoningSegmentId,
            text: delta.thinking,
          });
        } else if (delta.type === "text_delta") {
          if (reasoningOpen) {
            reasoningOpen = false;
            events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
          }
          if (delta.text) events.push({ type: "text-delta", text: delta.text });
        } else if (delta.type === "input_json_delta") {
          toolCallBuilder.add({ index: event.index, argumentsText: delta.partial_json });
          events.push({
            type: "tool-call-delta",
            index: event.index,
            argumentsText: delta.partial_json,
          });
        }
      } else if (event.type === "message_delta") {
        const reason = event.delta.stop_reason;
        if (reason === "tool_use") terminalStopReason = "tool_calls";
        else if (reason === "max_tokens") terminalStopReason = "length";
        else if (reason === "refusal") terminalStopReason = "error";
      }
      if (events.length > 0) {
        yield { content: textFromEvents(events), isComplete: false, events };
      }
    }
  } catch (error) {
    throw translateError(error);
  }

  const finalEvents: ModelStreamEvent[] = [];
  if (reasoningOpen) finalEvents.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
  finalEvents.push({ type: "complete", stopReason: terminalStopReason });
  const toolCalls = toolCallBuilder.build();
  yield {
    content: textFromEvents(finalEvents),
    isComplete: true,
    events: finalEvents,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function mapAnthropicToolChoice(request: ChatRequest): Anthropic.ToolChoice {
  const choice = request.toolChoice ?? { type: "auto" as const };
  if (choice.type === "specific") {
    validateSpecificTool(request, choice.name);
    return { type: "tool", name: choice.name };
  }
  if (choice.type === "required") return { type: "any" };
  if (choice.type === "none") return { type: "none" };
  return { type: "auto" };
}

function validateSpecificTool(request: ChatRequest, name: string): void {
  if (!request.tools?.some((tool) => tool.function.name === name)) {
    throw new AttestError({
      code: "UNSUPPORTED_CAPABILITY",
      message: `Specific tool is not defined: ${name}.`,
    });
  }
}
