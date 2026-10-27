import type OpenAI from "openai";

import { scheduleTimeout } from "@shared";
import { ChatRequest, ChatResponseChunk, ModelStreamEvent } from "@core/agent";
import { AttestError } from "@core/errors";
import { mapOpenAiMessage } from "../providers/messageMappers";
import { InlineReasoningParser } from "./InlineReasoningParser";
import {
  parseOpenAiChatDelta,
  parseOpenAiChatUsage,
  textFromEvents,
  ToolCallBuilder,
  UsageEvent,
} from "./chatStreamPrimitives";
import { fieldsAfterRefusal, RejectedFieldMemory } from "./optionalFieldRetry";
import { RepetitionDetector } from "./repetitionDetector";
import { parseTextToolCalls } from "./textToolCalls";

interface OpenAiChatStreamOptions {
  openai: OpenAI;
  request: ChatRequest;
  translateError: (error: unknown) => AttestError;
  onReasoningObserved?: (observation: { protocol: "chat-completions"; dialect: string }) => void;
  rejectedFields?: RejectedFieldMemory;
}

export const USAGE_GRACE_MS = 1500;

export async function* streamOpenAiCompatibleChat({
  openai,
  request,
  translateError,
  onReasoningObserved,
  rejectedFields = new RejectedFieldMemory(),
}: OpenAiChatStreamOptions): AsyncIterable<ChatResponseChunk> {
  const baseBody = {
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
  } satisfies Record<string, unknown>;
  const optionalFields = rejectedFields.accepted(request.model, {
    stream_options: { include_usage: true },
    ...reasoningBody(request),
  });

  const open = (
    body: Record<string, unknown>,
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> =>
    openai.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      { signal: request.signal },
    );

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  let attempt: Record<string, unknown> = optionalFields;
  let firstError: unknown;
  for (;;) {
    try {
      stream = await open({ ...baseBody, ...attempt });
      break;
    } catch (error) {
      throwIfAborted(request.signal);
      firstError ??= error;
      const kept = fieldsAfterRefusal(attempt, error);
      if (!kept) throw translateError(firstError);
      rejectedFields.remember(
        request.model,
        Object.keys(attempt).filter((key) => !(key in kept)),
      );
      attempt = kept;
    }
  }

  const toolCallBuilder = new ToolCallBuilder();
  const repetition = new RepetitionDetector();
  let sawNativeToolCall = false;
  let fullContent = "";
  let reasoningOpen = false;
  const reasoningSegmentId = "reasoning-0";
  const inlineReasoning = new InlineReasoningParser();
  let terminalStopReason: "complete" | "length" | "error" | "tool_calls" = "complete";
  let usage: UsageEvent | undefined;
  const observedDialects = new Set<string>();
  const observe = (dialect: string): void => {
    if (observedDialects.has(dialect)) return;
    observedDialects.add(dialect);
    onReasoningObserved?.({ protocol: "chat-completions", dialect });
  };

  try {
    const iterator = stream[Symbol.asyncIterator]();
    for (;;) {
      const next =
        terminalStopReason === "tool_calls"
          ? await nextWithin(iterator, USAGE_GRACE_MS)
          : await iterator.next();
      if (next === undefined) {
        closeQuietly(iterator);
        break;
      }
      if (next.done) break;
      const chunk = next.value;
      const reported = parseOpenAiChatUsage(chunk);
      usage = reported ?? usage;
      if (terminalStopReason === "tool_calls") {
        if (!reported) continue;
        closeQuietly(iterator);
        break;
      }
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
        terminalStopReason = "tool_calls";
      }
      if (events.length > 0) {
        yield { content: textFromEvents(events), isComplete: false, events };
      }
      if (repetition.isRepeating()) break;
    }
  } catch (error) {
    throwIfAborted(request.signal);
    throw translateError(error);
  }
  throwIfAborted(request.signal);

  const events: ModelStreamEvent[] = [];
  if (reasoningOpen) events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
  events.push(...inlineReasoning.finish());
  if (usage) events.push(usage);
  events.push({ type: "complete", stopReason: terminalStopReason });

  let toolCalls = toolCallBuilder.build();
  if (terminalStopReason !== "tool_calls" && !sawNativeToolCall && toolCalls.length === 0) {
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
 * Waits for the next stream chunk for at most the given time, so a server that
 * keeps the connection open after its last answer cannot stall the round.
 * Resolves undefined when the time runs out.
 */
async function nextWithin<T>(
  iterator: AsyncIterator<T>,
  delayMs: number,
): Promise<IteratorResult<T> | undefined> {
  let timer: { cancel: () => void } | undefined;
  const expiry = new Promise<undefined>((resolve) => {
    timer = scheduleTimeout(() => resolve(undefined), delayMs);
  });
  try {
    const pending = iterator.next();
    pending.catch(() => undefined);
    return await Promise.race([pending, expiry]);
  } finally {
    timer?.cancel();
  }
}

/** Closes an abandoned stream without letting its late failure go unhandled. */
function closeQuietly(iterator: AsyncIterator<unknown>): void {
  iterator.return?.().catch(() => undefined);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The request was aborted.", "AbortError");
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
    throw new AttestError({
      code: "UNSUPPORTED_CAPABILITY",
      message: `Specific tool is not defined: ${name}.`,
    });
  }
}
