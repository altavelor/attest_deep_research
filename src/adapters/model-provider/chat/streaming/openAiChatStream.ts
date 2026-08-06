import type OpenAI from "openai";

import { ChatRequest, ChatResponseChunk, ModelStreamEvent } from "@core/agent";
import { IxplorerError } from "@core/errors";
import { mapOpenAiMessage } from "../providers/messageMappers";
import { InlineReasoningParser } from "./InlineReasoningParser";
import { parseOpenAiChatDelta, textFromEvents, ToolCallBuilder } from "./chatStreamPrimitives";
import { RepetitionDetector } from "./repetitionDetector";
import { parseTextToolCalls } from "./textToolCalls";

interface OpenAiChatStreamOptions {
  openai: OpenAI;
  request: ChatRequest;
  translateError(error: unknown): IxplorerError;
  onReasoningObserved?(observation: { protocol: "chat-completions"; dialect: string }): void;
}

export async function* streamOpenAiCompatibleChat({
  openai,
  request,
  translateError,
  onReasoningObserved,
}: OpenAiChatStreamOptions): AsyncIterable<ChatResponseChunk> {
  const body = {
    model: request.model,
    messages: request.messages.map(mapOpenAiMessage),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    stream: true,
    ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
    ...(request.toolChoice ? { tool_choice: mapOpenAiToolChoice(request) } : {}),
    ...(request.parallelToolCalls !== undefined
      ? { parallel_tool_calls: request.parallelToolCalls }
      : {}),
    ...reasoningBody(request),
  } satisfies Record<string, unknown>;

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await openai.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      { signal: request.signal },
    );
  } catch (error) {
    throw translateError(error);
  }

  const toolCallBuilder = new ToolCallBuilder();
  const repetition = new RepetitionDetector();
  let sawNativeToolCall = false;
  let fullContent = "";
  let reasoningOpen = false;
  const reasoningSegmentId = "reasoning-0";
  const inlineReasoning = new InlineReasoningParser();
  let terminalStopReason: "complete" | "length" | "error" = "complete";
  const observedDialects = new Set<string>();
  const observe = (dialect: string): void => {
    if (observedDialects.has(dialect)) return;
    observedDialects.add(dialect);
    onReasoningObserved?.({ protocol: "chat-completions", dialect });
  };

  try {
    for await (const chunk of stream) {
      const parsed = parseOpenAiChatDelta(chunk);
      if (parsed.finishReason === "length") terminalStopReason = "length";
      else if (
        parsed.finishReason &&
        parsed.finishReason !== "stop" &&
        parsed.finishReason !== "tool_calls" &&
        parsed.finishReason !== "function_call"
      ) {
        terminalStopReason = "error";
      }

      const events: ModelStreamEvent[] = [];
      if (parsed.reasoning) {
        observe(parsed.reasoningDialect);
        if (!reasoningOpen) {
          reasoningOpen = true;
          events.push({
            type: "reasoning-start",
            segmentId: reasoningSegmentId,
            visibility: parsed.reasoningVisibility,
          });
        }
        events.push({
          type: "reasoning-delta",
          segmentId: reasoningSegmentId,
          text: parsed.reasoning,
        });
      }
      if (parsed.content) {
        fullContent += parsed.content;
        repetition.push(parsed.content);
        if (reasoningOpen) {
          reasoningOpen = false;
          events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
        }
        const inlineEvents = inlineReasoning.push(parsed.content);
        if (inlineEvents.some((candidate) => candidate.type === "reasoning-start")) {
          observe("inline-tags");
        }
        events.push(...inlineEvents);
      }
      for (const delta of parsed.toolCallDeltas) {
        sawNativeToolCall = true;
        toolCallBuilder.add(delta);
        events.push({
          type: "tool-call-delta",
          index: delta.index ?? 0,
          ...(delta.id ? { id: delta.id } : {}),
          ...(delta.name ? { name: delta.name } : {}),
          ...(delta.argumentsText ? { argumentsText: delta.argumentsText } : {}),
        });
      }
      if (parsed.finishReason === "tool_calls" || parsed.finishReason === "function_call") {
        if (reasoningOpen) events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
        events.push(...inlineReasoning.finish());
        events.push({ type: "complete", stopReason: "tool_calls" });
        yield {
          content: textFromEvents(events),
          isComplete: true,
          toolCalls: toolCallBuilder.build(),
          events,
        };
        return;
      }
      if (events.length > 0) {
        yield { content: textFromEvents(events), isComplete: false, events };
      }
      if (repetition.isRepeating()) break;
    }
  } catch (error) {
    throw translateError(error);
  }

  const events: ModelStreamEvent[] = [];
  if (reasoningOpen) events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
  events.push(...inlineReasoning.finish());
  events.push({ type: "complete", stopReason: terminalStopReason });

  let toolCalls = toolCallBuilder.build();
  if (!sawNativeToolCall && toolCalls.length === 0) {
    const textCalls = parseTextToolCalls(fullContent, request.tools);
    for (const textCall of textCalls) {
      toolCallBuilder.add({
        id: textCall.id,
        name: textCall.name,
        argumentsText: JSON.stringify(textCall.arguments),
      });
    }
    toolCalls = toolCallBuilder.build();
  }
  yield {
    content: textFromEvents(events),
    isComplete: true,
    events,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

/**
 * Mirrors the reasoning switch onto the two body dialects openai-compatible
 * gateways understand: `reasoning` for OpenRouter-style routers and
 * `chat_template_kwargs.enable_thinking` for vLLM-style hybrid models. Nothing is
 * sent when the caller states no preference, so unaware providers see no new field.
 */
function reasoningBody(request: ChatRequest): Record<string, unknown> {
  if (request.reasoningEnabled === undefined) {
    return {};
  }
  return {
    reasoning: {
      enabled: request.reasoningEnabled,
      ...(request.reasoningEnabled && request.reasoningEffort
        ? { effort: request.reasoningEffort }
        : {}),
    },
    chat_template_kwargs: { enable_thinking: request.reasoningEnabled },
  };
}

function mapOpenAiToolChoice(request: ChatRequest): unknown {
  const choice = request.toolChoice!;
  if (choice.type !== "specific") return choice.type;
  validateSpecificTool(request, choice.name);
  return { type: "function", function: { name: choice.name } };
}

function validateSpecificTool(request: ChatRequest, name: string): void {
  if (!request.tools?.some((tool) => tool.function.name === name)) {
    throw new IxplorerError({
      code: "UNSUPPORTED_CAPABILITY",
      message: `Specific tool is not defined: ${name}.`,
    });
  }
}
