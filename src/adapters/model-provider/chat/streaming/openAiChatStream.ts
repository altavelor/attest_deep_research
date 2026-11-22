import { isRecord, scheduleTimeout, type ScheduledTimeout } from "@shared";
import { ChatRequest, ChatResponseChunk, ModelRoundResult, ModelStreamEvent } from "@core/agent";
import { AttestError } from "@core/errors";
import type { ProviderHttpClient } from "../../common/http";
import { mapOpenAiMessage } from "../providers/messageMappers";
import type { ChatCompletionsDialect } from "./chatCompletionsDialect";
import { openChatCompletionsStream } from "./chatCompletionsHttp";
import { InlineReasoningParser } from "./InlineReasoningParser";
import {
  parseChatCompletionsUsage,
  parseOpenAiChatDelta,
  textFromEvents,
  ToolCallBuilder,
} from "./chatStreamPrimitives";
import { RepetitionDetector } from "./repetitionDetector";
import { parseTextToolCalls } from "./textToolCalls";

interface OpenAiChatStreamOptions {
  http: ProviderHttpClient;
  request: ChatRequest;
  dialect: ChatCompletionsDialect;
  onReasoningObserved?: (observation: { protocol: "chat-completions"; dialect: string }) => void;
}

const USAGE_TRAILER_TIMEOUT_MS = 2_000;

/**
 * Streams one Chat Completions round as chat chunks. The stream is read under its own
 * abort signal, linked to the request's, so a missing usage trailer can be given up on.
 */
export async function* streamOpenAiCompatibleChat(
  options: OpenAiChatStreamOptions,
): AsyncIterable<ChatResponseChunk> {
  const streamAbort = linkedAbortController(options.request.signal);
  try {
    yield* readChatCompletionsRound(options, streamAbort.controller);
  } finally {
    streamAbort.dispose();
  }
}

async function* readChatCompletionsRound(
  { http, request, dialect, onReasoningObserved }: OpenAiChatStreamOptions,
  streamAbort: AbortController,
): AsyncIterable<ChatResponseChunk> {
  const baseBody = {
    model: request.model,
    messages: request.messages.map(mapOpenAiMessage),
    temperature: request.temperature,
    max_tokens: request.maxTokens ?? dialect.defaultMaxTokens,
    stream: true,
    ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
    ...(request.toolChoice ? { tool_choice: mapOpenAiToolChoice(request, dialect) } : {}),
    ...(request.parallelToolCalls !== undefined
      ? { parallel_tool_calls: request.parallelToolCalls }
      : {}),
  } satisfies Record<string, unknown>;
  const optionalFields = {
    ...(dialect.sendsReasoningFields ? reasoningBody(request) : {}),
    ...(dialect.requestsStreamUsage ? { stream_options: { include_usage: true } } : {}),
  };

  const open = (body: Record<string, unknown>): Promise<AsyncIterable<Record<string, unknown>>> =>
    openChatCompletionsStream(http, body, streamAbort.signal);

  let stream: AsyncIterable<Record<string, unknown>>;
  let attempt: Record<string, unknown> = optionalFields;
  let firstError: unknown;
  for (;;) {
    try {
      stream = await open({ ...baseBody, ...attempt });
      break;
    } catch (error) {
      throwIfAborted(request.signal);
      firstError ??= error;
      if (Object.keys(attempt).length === 0 || !rejectsUnknownField(error)) {
        throw firstError;
      }
      attempt = withoutRejectedFields(attempt, error);
    }
  }

  const toolCallBuilder = new ToolCallBuilder();
  const repetition = new RepetitionDetector();
  let sawNativeToolCall = false;
  let fullContent = "";
  let reasoningOpen = false;
  const reasoningSegmentId = "reasoning-0";
  const inlineReasoning = new InlineReasoningParser();
  let terminalStopReason: "complete" | "length" | "error" = "complete";
  let finishedWithToolCalls = false;
  const awaitsUsageChunk = "stream_options" in attempt;
  let usage: ModelRoundResult["usage"];
  let usageTrailerDeadline: ScheduledTimeout | undefined;
  let usageTrailerExpired = false;
  const observedDialects = new Set<string>();
  const observe = (dialect: string): void => {
    if (observedDialects.has(dialect)) return;
    observedDialects.add(dialect);
    onReasoningObserved?.({ protocol: "chat-completions", dialect });
  };

  try {
    for await (const chunk of stream) {
      usage = parseChatCompletionsUsage(chunk) ?? usage;
      if (finishedWithToolCalls) {
        if (usage) break;
        continue;
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
      if (events.length > 0) {
        yield { content: textFromEvents(events), isComplete: false, events };
      }
      if (parsed.finishReason === "tool_calls" || parsed.finishReason === "function_call") {
        finishedWithToolCalls = true;
        if (!awaitsUsageChunk || usage) break;
        usageTrailerDeadline = scheduleTimeout(() => {
          usageTrailerExpired = true;
          streamAbort.abort(new DOMException("The usage trailer did not arrive.", "TimeoutError"));
        }, USAGE_TRAILER_TIMEOUT_MS);
      }
      if (repetition.isRepeating()) break;
    }
  } catch (error) {
    throwIfAborted(request.signal);
    if (!usageTrailerExpired) throw error;
  } finally {
    usageTrailerDeadline?.cancel();
  }

  const events: ModelStreamEvent[] = [];
  if (reasoningOpen) events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
  events.push(...inlineReasoning.finish());
  if (usage) events.push({ type: "usage", ...usage });
  if (finishedWithToolCalls) {
    events.push({ type: "complete", stopReason: "tool_calls" });
    yield {
      content: textFromEvents(events),
      isComplete: true,
      toolCalls: toolCallBuilder.build(),
      events,
    };
    return;
  }
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

/** Creates a controller that also aborts with the reason of `signal`, until `dispose` detaches it. */
function linkedAbortController(signal: AbortSignal | undefined): {
  controller: AbortController;
  dispose(): void;
} {
  const controller = new AbortController();
  const forward = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) forward();
  else signal?.addEventListener("abort", forward, { once: true });
  return { controller, dispose: () => signal?.removeEventListener("abort", forward) };
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

/**
 * True when the provider refused the request body itself, which is how a server
 * with strict validation answers a field it does not know. Any other failure
 * belongs to the caller and must not be retried.
 */
function rejectsUnknownField(error: unknown): boolean {
  const status: unknown =
    error instanceof AttestError && isRecord(error.details) ? error.details.status : undefined;
  return status === 400 || status === 422;
}

/**
 * Drops only the dialects the provider named in its refusal, so a gateway that
 * understands one of them still receives it on the retry. A refusal that names
 * none of them costs every optional field, which is the previous behaviour
 * and keeps the retry loop finite.
 */
function withoutRejectedFields(
  fields: Record<string, unknown>,
  error: unknown,
): Record<string, unknown> {
  const message = refusalText(error).toLowerCase();
  const kept = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !message.includes(key.toLowerCase())),
  );
  return Object.keys(kept).length === Object.keys(fields).length ? {} : kept;
}

function refusalText(error: unknown): string {
  if (!(error instanceof AttestError)) {
    return "";
  }
  const nested: unknown = isRecord(error.details) ? error.details.providerMessage : undefined;
  return [error.message, nested].filter((part) => typeof part === "string").join(" ");
}

/**
 * Maps the requested tool choice to the Chat Completions field, downgrading a
 * forced choice to `auto` on hosts that reject it after the named tool is validated.
 */
function mapOpenAiToolChoice(request: ChatRequest, dialect: ChatCompletionsDialect): unknown {
  const choice = request.toolChoice!;
  if (choice.type === "specific") validateSpecificTool(request, choice.name);
  if (!dialect.supportsForcedToolChoice && choice.type !== "none") return "auto";
  if (choice.type !== "specific") return choice.type;
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
