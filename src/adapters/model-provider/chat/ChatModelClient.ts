import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import {
  Ollama,
  type AbortableAsyncIterator,
  type ChatResponse as OllamaChatResponse,
  type Message as OllamaMessage,
  type Tool as OllamaTool,
} from "ollama";

import { IxplorerError } from "@core/errors";
import { isRecord } from "@shared";
import { ApiFormat, ChatMessage, ChatModelProvider, ChatRequest, ChatResponseChunk, ModelStreamEvent } from "@core/agent";
import { ChatToolCall } from "@core/agent";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { withLoggedErrors } from "../common/withLoggedErrors";
import { InlineReasoningParser } from "./streaming/InlineReasoningParser";
import { createOpenAiClient, translateOpenAiError } from "./providers/openAiSdk";
import { createAnthropicClient, createLoggingFetch, translateAnthropicError } from "./providers/anthropicSdk";
import { parseTextToolCalls } from "./streaming/textToolCalls";
import { RepetitionDetector } from "./streaming/repetitionDetector";

export interface ChatModelClientOptions {
  apiFormat?: ApiFormat;
  provider?: ApiFormat | "lmStudio";
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
  onReasoningObserved?(observation: { protocol: "chat-completions"; dialect: string }): void;
}

export class ChatModelClient implements ChatModelProvider {
  private readonly provider: ApiFormat;
  private readonly openai?: OpenAI;
  private readonly anthropic?: Anthropic;
  private readonly ollama?: Ollama;
  private readonly apiKey?: string;
  private readonly logger?: PluginRequestLogger;
  private readonly onReasoningObserved?: ChatModelClientOptions["onReasoningObserved"];

  constructor(options: ChatModelClientOptions) {
    this.provider = normalizeApiFormat(options.apiFormat ?? options.provider);
    this.apiKey = options.apiKey;
    this.logger = options.logger;
    this.onReasoningObserved = options.onReasoningObserved;
    // Every provider goes through its official SDK; the SDK owns the
    // HTTP/SSE protocol, tool-call streaming, and reasoning/thinking decoding.
    if (this.provider === "openai-compatible") {
      this.openai = createOpenAiClient(options);
    } else if (this.provider === "anthropic") {
      this.anthropic = createAnthropicClient(options);
    } else if (this.provider === "ollama") {
      this.ollama = new Ollama({
        host: normalizeOllamaHost(options.baseUrl),
        fetch: createLoggingFetch(options.fetch ?? fetch, { logger: options.logger }),
      });
    }
  }

  async listModels(): Promise<string[]> {
    return withLoggedErrors(
      () =>
        this.provider === "ollama"
          ? this.listOllamaModels()
          : this.provider === "anthropic"
            ? this.listAnthropicModels()
            : this.listOpenAiCompatibleModels(),
      this.logger,
    );
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    try {
      if (this.provider === "ollama") {
        yield* this.streamOllamaChat(request);
      } else if (this.provider === "anthropic") {
        yield* this.streamAnthropicChat(request);
      } else {
        yield* this.streamOpenAiCompatibleChat(request);
      }
    } catch (error) {
      this.logger?.logError(error);
      throw error;
    }
  }

  private async listOpenAiCompatibleModels(): Promise<string[]> {
    try {
      const page = await this.openai!.models.list();
      return page.data
        .map((model) => model.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    } catch (error) {
      throw this.translateOpenAiError(error);
    }
  }

  private translateOpenAiError(error: unknown): IxplorerError {
    return translateOpenAiError(error, {
      unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
      unavailableMessage: "The chat model provider is unavailable.",
      apiKey: this.apiKey,
    });
  }

  private async listAnthropicModels(): Promise<string[]> {
    try {
      const page = await this.anthropic!.models.list();
      return page.data
        .map((model) => model.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    } catch (error) {
      throw this.translateAnthropicError(error);
    }
  }

  private async listOllamaModels(): Promise<string[]> {
    let body: Awaited<ReturnType<Ollama["list"]>>;
    try {
      body = await this.ollama!.list();
    } catch (error) {
      throw translateOllamaError(error, this.apiKey);
    }

    return body.models
      .map((model) => model.name || model.model)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
  }

  private translateAnthropicError(error: unknown): IxplorerError {
    return translateAnthropicError(error, {
      unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
      unavailableMessage: "The chat model provider is unavailable.",
      apiKey: this.apiKey,
    });
  }

  private async *streamOpenAiCompatibleChat(
    request: ChatRequest,
  ): AsyncIterable<ChatResponseChunk> {
    // Build the request body up front so synchronous validation (e.g. an
    // unsupported specific tool choice) throws before any network call.
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
    } satisfies Record<string, unknown>;

    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await this.openai!.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        { signal: request.signal },
      );
    } catch (error) {
      throw this.translateOpenAiError(error);
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
      this.onReasoningObserved?.({ protocol: "chat-completions", dialect });
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
        )
          terminalStopReason = "error";
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
        // Cut off a model that has collapsed into repeating the same block; finish
        // gracefully via the terminal block below instead of streaming forever.
        if (repetition.isRepeating()) break;
      }
    } catch (error) {
      throw this.translateOpenAiError(error);
    }

    const events: ModelStreamEvent[] = [];
    if (reasoningOpen) events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
    events.push(...inlineReasoning.finish());
    events.push({ type: "complete", stopReason: terminalStopReason });

    // Some OpenAI-compatible servers (notably LM Studio) finish the stream with
    // `finish_reason: "stop"` even when the model emitted structured tool_calls,
    // and some local templates leak tool calls as plain text. Recover both here
    // so the tool loop — and the capability probe — see the calls.
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

  private async *streamAnthropicChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    // Build the params up front so synchronous validation (e.g. an unknown
    // specific tool choice) throws before any network call.
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
          // Adaptive thinking is the supported on-mode for current Claude
          // models; `summarized` surfaces the reasoning we stream to the UI.
          // Adaptive-thinking models reject sampling parameters, so we omit
          // temperature here.
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
      stream = await this.anthropic!.messages.create(body, { signal: request.signal });
    } catch (error) {
      throw this.translateAnthropicError(error);
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
            events.push({ type: "reasoning-delta", segmentId: reasoningSegmentId, text: delta.thinking });
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
      throw this.translateAnthropicError(error);
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

  private async *streamOllamaChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    validateOllamaToolChoice(request);
    const hasTools =
      request.toolChoice?.type !== "none" && request.tools !== undefined && request.tools.length > 0;
    const options =
      request.temperature === undefined && request.maxTokens === undefined
        ? undefined
        : { temperature: request.temperature, num_predict: request.maxTokens };

    let stream: AbortableAsyncIterator<OllamaChatResponse>;
    try {
      stream = await this.ollama!.chat({
        model: request.model,
        messages: request.messages.map(mapOllamaMessage) as unknown as OllamaMessage[],
        stream: true,
        ...(hasTools ? { tools: request.tools as unknown as OllamaTool[] } : {}),
        ...(request.reasoningEnabled ? { think: ollamaThink(request.reasoningEffort) } : {}),
        ...(options ? { options } : {}),
      });
    } catch (error) {
      throw translateOllamaError(error, this.apiKey);
    }

    if (request.signal) {
      if (request.signal.aborted) stream.abort();
      else request.signal.addEventListener("abort", () => stream.abort(), { once: true });
    }

    const toolCallBuilder = new ToolCallBuilder();
    const repetition = new RepetitionDetector();
    const reasoningSegmentId = "reasoning-0";
    let reasoningOpen = false;
    let sawNativeToolCall = false;
    let fullContent = "";

    try {
      for await (const part of stream) {
        const events: ModelStreamEvent[] = [];
        const thinking = part.message?.thinking;
        if (thinking) {
          if (!reasoningOpen) {
            reasoningOpen = true;
            events.push({
              type: "reasoning-start",
              segmentId: reasoningSegmentId,
              visibility: "text",
            });
          }
          events.push({ type: "reasoning-delta", segmentId: reasoningSegmentId, text: thinking });
        }
        const content = part.message?.content ?? "";
        if (content) {
          if (reasoningOpen) {
            reasoningOpen = false;
            events.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
          }
          fullContent += content;
          repetition.push(content);
          events.push({ type: "text-delta", text: content });
        }
        for (const toolCall of part.message?.tool_calls ?? []) {
          sawNativeToolCall = true;
          toolCallBuilder.add({
            name: toolCall.function.name,
            argumentsText: JSON.stringify(toolCall.function.arguments ?? {}),
          });
        }
        if (events.length > 0) {
          yield { content: textFromEvents(events), isComplete: false, events };
        }

        // Cut off a model that has collapsed into repeating the same block.
        if (part.done || repetition.isRepeating()) {
          const finalEvents: ModelStreamEvent[] = [];
          if (reasoningOpen) {
            finalEvents.push({ type: "reasoning-end", segmentId: reasoningSegmentId });
          }
          finalEvents.push({ type: "complete", stopReason: "complete" });
          let toolCalls = toolCallBuilder.build();
          // Some local model templates leak tool calls as plain text instead of
          // structured tool_calls; recover them so the tool loop can proceed.
          if (!sawNativeToolCall && toolCalls.length === 0) {
            for (const textCall of parseTextToolCalls(fullContent, request.tools)) {
              toolCallBuilder.add({
                id: textCall.id,
                name: textCall.name,
                argumentsText: JSON.stringify(textCall.arguments),
              });
            }
            toolCalls = toolCallBuilder.build();
          }
          yield {
            content: textFromEvents(finalEvents),
            isComplete: true,
            events: finalEvents,
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
          };
          return;
        }
      }
    } catch (error) {
      throw translateOllamaError(error, this.apiKey);
    }

    yield { content: "", isComplete: true, events: [{ type: "complete", stopReason: "complete" }] };
  }

}

function mapOpenAiToolChoice(request: ChatRequest): unknown {
  const choice = request.toolChoice!;
  if (choice.type !== "specific") return choice.type;
  validateSpecificTool(request, choice.name);
  return { type: "function", function: { name: choice.name } };
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

function normalizeOllamaHost(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function ollamaThink(effort: string | undefined): boolean | "high" | "medium" | "low" {
  if (effort === "high" || effort === "medium" || effort === "low") return effort;
  return true;
}

function translateOllamaError(error: unknown, apiKey: string | undefined): IxplorerError | never {
  if (error instanceof IxplorerError) return error;
  if (error instanceof Error && error.name === "AbortError") throw error;
  // The Ollama SDK throws a ResponseError carrying the HTTP status_code.
  const status =
    isRecord(error) && typeof error.status_code === "number" ? error.status_code : undefined;
  if (status === 404) {
    return new IxplorerError({ code: "MODEL_NOT_FOUND", details: { status } });
  }
  const message =
    isRecord(error) && typeof error.error === "string"
      ? sanitizeOllamaMessage(error.error, apiKey)
      : undefined;
  return new IxplorerError({
    code: "MODEL_PROVIDER_UNAVAILABLE",
    message: "The chat model provider is unavailable.",
    ...(status !== undefined || message
      ? { details: { ...(status !== undefined ? { status } : {}), ...(message ? { providerMessage: message } : {}) } }
      : {}),
    cause: error,
  });
}

function sanitizeOllamaMessage(value: string, apiKey: string | undefined): string {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 500);
  return apiKey ? normalized.split(apiKey).join("[redacted]") : normalized;
}

function validateOllamaToolChoice(request: ChatRequest): void {
  if (request.toolChoice?.type === "required" || request.toolChoice?.type === "specific") {
    throw unsupported("Ollama does not support required or specific tool choice.");
  }
}

function validateSpecificTool(request: ChatRequest, name: string): void {
  if (!request.tools?.some((tool) => tool.function.name === name)) {
    throw unsupported(`Specific tool is not defined: ${name}.`);
  }
}

function unsupported(message: string): IxplorerError {
  return new IxplorerError({ code: "UNSUPPORTED_CAPABILITY", message });
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  name?: string;
  argumentsText?: string;
}

class ToolCallBuilder {
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

function parseOpenAiChatDelta(chunk: unknown): {
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

  if (!isRecord(chunk) || !Array.isArray(chunk.choices)) {
    return empty;
  }

  const firstChoice: unknown = chunk.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
    return empty;
  }

  const delta = firstChoice.delta;
  const reasoning = readReasoningDelta(delta);
  return {
    content: typeof delta.content === "string" ? delta.content : "",
    reasoning: reasoning.text,
    reasoningDialect: reasoning.dialect,
    reasoningVisibility: reasoning.visibility,
    finishReason:
      typeof firstChoice.finish_reason === "string" ? firstChoice.finish_reason : undefined,
    toolCallDeltas: parseOpenAiToolCallDeltas(delta.tool_calls),
  };
}

function readReasoningDelta(delta: Record<string, unknown>): {
  text: string;
  dialect: string;
  visibility: "text" | "summary";
} {
  const details = visibleReasoningDetails(delta.reasoning_details);
  if (details) return { ...details, dialect: "reasoning_details" };
  for (const key of ["reasoning", "reasoning_content", "thinking"] as const) {
    if (typeof delta[key] === "string" && delta[key]) {
      return { text: delta[key], visibility: "text", dialect: key };
    }
  }
  return { text: "", visibility: "text", dialect: "" };
}

function visibleReasoningDetails(value: unknown):
  | {
    text: string;
    visibility: "text" | "summary";
  }
  | undefined {
  const values = Array.isArray(value) ? value : [value];
  const visible: Array<{ text: string; visibility: "text" | "summary" }> = [];
  for (const item of values) {
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
    if (!text) continue;
    const visibility =
      item.type === "reasoning.summary" || item.type === "summary" ? "summary" : "text";
    visible.push({ text, visibility });
  }
  return visible.length > 0
    ? {
      text: visible.map((item) => item.text).join(""),
      visibility: visible.every((item) => item.visibility === "summary") ? "summary" : "text",
    }
    : undefined;
}

function textFromEvents(events: ModelStreamEvent[]): string {
  return events
    .filter(
      (event): event is Extract<ModelStreamEvent, { type: "text-delta" }> =>
        event.type === "text-delta",
    )
    .map((event) => event.text)
    .join("");
}

function normalizeApiFormat(value: ApiFormat | "lmStudio" | undefined): ApiFormat {
  return value === "lmStudio" || value === undefined ? "openai-compatible" : value;
}

function parseOpenAiToolCallDeltas(value: unknown): ToolCallDelta[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((toolCall) => ({
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
  }));
}

function parseToolArguments(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return { raw: value };
  }
}

function mapOpenAiMessage(message: ChatMessage): Record<string, unknown> {
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
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }

  return { role: message.role, content: message.content };
}

function mapOllamaMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((toolCall) => ({
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      })),
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }

  return { role: message.role, content: message.content };
}

function mapAnthropicMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    const content = [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...message.toolCalls.map((toolCall) => ({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.arguments,
      })),
    ];
    return { role: "assistant", content };
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

function mapAnthropicMessages(messages: ChatMessage[]): Record<string, unknown>[] {
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
