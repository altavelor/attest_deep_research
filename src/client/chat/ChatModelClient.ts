import { IxplorerError } from "../../shared/errors";
import { isRecord } from "../../shared/guards";
import {
  ApiFormat,
  ChatMessage,
  ChatModelProvider,
  ChatRequest,
  ChatResponseChunk,
  ChatToolCall,
} from "../../shared/types";
import {
  isOllamaTagsResponse,
  isOpenAiModelsResponse,
  modelNamesFromOllamaTags,
  modelNamesFromOpenAiModels,
} from "../common/models";
import type { PluginRequestLogger } from "../../settings/debugLogger";
import { ProviderHttpClient } from "../common/http";
import { parseJsonLines, parseServerSentEvents } from "../common/streams";

export interface ChatModelClientOptions {
  apiFormat?: ApiFormat;
  provider?: ApiFormat | "lmStudio";
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
}

export class ChatModelClient implements ChatModelProvider {
  private readonly provider: ApiFormat;
  private readonly http: ProviderHttpClient;
  private readonly logger?: PluginRequestLogger;

  constructor(options: ChatModelClientOptions) {
    this.provider = normalizeApiFormat(options.apiFormat ?? options.provider);
    this.logger = options.logger;
    this.http = new ProviderHttpClient({
      ...options,
      apiFormat: this.provider,
      unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
      unavailableMessage: "The chat model provider is unavailable.",
    });
  }

  async listModels(): Promise<string[]> {
    return this.withLoggedErrors(() =>
      this.provider === "ollama"
        ? this.listOllamaModels()
        : this.provider === "anthropic"
          ? this.listAnthropicModels()
          : this.listOpenAiCompatibleModels(),
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
    const response = await this.http.request("/models", { method: "GET" });
    const body = await this.http.readJson(
      response,
      "The chat model provider returned invalid JSON.",
    );

    if (!isOpenAiModelsResponse(body)) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "The OpenAI-compatible provider returned an invalid models response.",
      });
    }

    return modelNamesFromOpenAiModels(body);
  }

  private async listAnthropicModels(): Promise<string[]> {
    const response = await this.http.request("/models", {
      method: "GET",
      headers: { "anthropic-version": "2023-06-01" },
    });
    const body = await this.http.readJson(response, "The chat model provider returned invalid JSON.");

    if (!isOpenAiModelsResponse(body)) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "Anthropic returned an invalid models response.",
      });
    }

    return modelNamesFromOpenAiModels(body);
  }

  private async listOllamaModels(): Promise<string[]> {
    const response = await this.http.request("/tags", { method: "GET" });
    const body = await this.http.readJson(
      response,
      "The chat model provider returned invalid JSON.",
    );

    if (!isOllamaTagsResponse(body)) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "Ollama returned an invalid tags response.",
      });
    }

    return modelNamesFromOllamaTags(body);
  }

  private async *streamOpenAiCompatibleChat(
    request: ChatRequest,
  ): AsyncIterable<ChatResponseChunk> {
    const response = await this.http.request("/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
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
      }),
      signal: request.signal,
    });

    if (!response.body) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "The OpenAI-compatible provider returned an empty chat stream.",
      });
    }

    const toolCallBuilder = new ToolCallBuilder();

    for await (const event of parseServerSentEvents(response.body)) {
      if (event === "[DONE]") {
        yield { content: "", isComplete: true };
        return;
      }

      const parsed = parseOpenAiChatEvent(event);
      if (parsed.content) {
        yield { content: parsed.content, isComplete: false };
      }
      for (const delta of parsed.toolCallDeltas) {
        toolCallBuilder.add(delta);
      }
      if (parsed.finishReason === "tool_calls" || parsed.finishReason === "function_call") {
        yield { content: "", isComplete: true, toolCalls: toolCallBuilder.build() };
        return;
      }
    }

    yield { content: "", isComplete: true };
  }

  private async *streamAnthropicChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    const systemMessage = request.messages.find((message) => message.role === "system")?.content;
    const messages = request.messages
      .filter((message) => message.role !== "system");
    const response = await this.http.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: request.model,
        messages: mapAnthropicMessages(messages),
        system: systemMessage || undefined,
        temperature: request.temperature,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.function.name,
                description: tool.function.description,
                input_schema: tool.function.parameters,
              })),
              tool_choice: mapAnthropicToolChoice(request),
            }
          : {}),
      }),
      signal: request.signal,
    });

    if (!response.body) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "Anthropic returned an empty chat stream.",
      });
    }

    const toolCallBuilder = new ToolCallBuilder();

    for await (const event of parseServerSentEvents(response.body)) {
      const parsed = parseAnthropicChatEvent(event);
      if (parsed.content) {
        yield { content: parsed.content, isComplete: false };
      }
      for (const delta of parsed.toolCallDeltas) {
        toolCallBuilder.add(delta);
      }
      if (parsed.isComplete) {
        const toolCalls = toolCallBuilder.build();
        yield {
          content: "",
          isComplete: true,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
        return;
      }
    }

    yield { content: "", isComplete: true };
  }

  private async *streamOllamaChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    validateOllamaToolChoice(request);
    const response = await this.http.request("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(mapOllamaMessage),
        stream: true,
        ...(request.toolChoice?.type !== "none" && request.tools && request.tools.length > 0
          ? { tools: request.tools }
          : {}),
        options:
          request.temperature === undefined && request.maxTokens === undefined
            ? undefined
            : { temperature: request.temperature, num_predict: request.maxTokens },
      }),
      signal: request.signal,
    });

    if (!response.body) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "Ollama returned an empty chat stream.",
      });
    }

    const toolCallBuilder = new ToolCallBuilder();

    for await (const line of parseJsonLines(response.body)) {
      const parsed = parseOllamaChatLine(line);
      if (parsed.content) {
        yield { content: parsed.content, isComplete: false };
      }
      for (const toolCall of parsed.toolCalls) {
        toolCallBuilder.add({
          id: toolCall.id,
          name: toolCall.name,
          argumentsText: JSON.stringify(toolCall.arguments),
        });
      }

      if (parsed.done) {
        const toolCalls = toolCallBuilder.build();
        yield {
          content: "",
          isComplete: true,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
        return;
      }
    }

    yield { content: "", isComplete: true };
  }

  private async withLoggedErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger?.logError(error);
      throw error;
    }
  }
}

function mapOpenAiToolChoice(request: ChatRequest): unknown {
  const choice = request.toolChoice!;
  if (choice.type !== "specific") return choice.type;
  validateSpecificTool(request, choice.name);
  return { type: "function", function: { name: choice.name } };
}

function mapAnthropicToolChoice(request: ChatRequest): Record<string, unknown> {
  const choice = request.toolChoice ?? { type: "auto" as const };
  if ((choice.type === "required" || choice.type === "specific") && request.reasoningEnabled) {
    throw unsupported("Anthropic forced tool choice is incompatible with reasoning.");
  }
  if (choice.type === "specific") {
    validateSpecificTool(request, choice.name);
    return { type: "tool", name: choice.name };
  }
  return { type: choice.type === "required" ? "any" : choice.type };
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

function parseOpenAiChatEvent(event: string): {
  content: string;
  toolCallDeltas: ToolCallDelta[];
  finishReason?: string;
} {
  try {
    const parsed: unknown = JSON.parse(event);
    if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
      return { content: "", toolCallDeltas: [] };
    }

    const firstChoice: unknown = parsed.choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
      return { content: "", toolCallDeltas: [] };
    }

    const delta = firstChoice.delta;
    return {
      content: typeof delta.content === "string" ? delta.content : "",
      finishReason:
        typeof firstChoice.finish_reason === "string" ? firstChoice.finish_reason : undefined,
      toolCallDeltas: parseOpenAiToolCallDeltas(delta.tool_calls),
    };
  } catch {
    return { content: "", toolCallDeltas: [] };
  }
}

function normalizeApiFormat(value: ApiFormat | "lmStudio" | undefined): ApiFormat {
  return value === "lmStudio" || value === undefined ? "openai-compatible" : value;
}

function parseOpenAiToolCallDeltas(value: unknown): ToolCallDelta[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((toolCall) => ({
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

function parseAnthropicChatEvent(event: string): {
  content: string;
  toolCallDeltas: ToolCallDelta[];
  isComplete: boolean;
} {
  try {
    const parsed: unknown = JSON.parse(event);
    if (!isRecord(parsed)) {
      return { content: "", toolCallDeltas: [], isComplete: false };
    }

    if (parsed.type === "message_stop") {
      return { content: "", toolCallDeltas: [], isComplete: true };
    }

    if (parsed.type === "content_block_start" && isRecord(parsed.content_block)) {
      const block = parsed.content_block;
      if (block.type === "tool_use") {
        return {
          content: "",
          isComplete: false,
          toolCallDeltas: [
            {
              index: typeof parsed.index === "number" ? parsed.index : undefined,
              id: typeof block.id === "string" ? block.id : undefined,
              name: typeof block.name === "string" ? block.name : undefined,
              argumentsText:
                isRecord(block.input) && Object.keys(block.input).length > 0
                  ? JSON.stringify(block.input)
                  : "",
            },
          ],
        };
      }
    }

    if (parsed.type !== "content_block_delta" || !isRecord(parsed.delta)) {
      return { content: "", toolCallDeltas: [], isComplete: false };
    }

    if (parsed.delta.type === "text_delta" && typeof parsed.delta.text === "string") {
      return { content: parsed.delta.text, toolCallDeltas: [], isComplete: false };
    }

    if (parsed.delta.type === "input_json_delta" && typeof parsed.delta.partial_json === "string") {
      return {
        content: "",
        isComplete: false,
        toolCallDeltas: [
          {
            index: typeof parsed.index === "number" ? parsed.index : undefined,
            argumentsText: parsed.delta.partial_json,
          },
        ],
      };
    }

    return { content: "", toolCallDeltas: [], isComplete: false };
  } catch {
    return { content: "", toolCallDeltas: [], isComplete: false };
  }
}

function parseOllamaChatLine(line: string): {
  content: string;
  done: boolean;
  toolCalls: ChatToolCall[];
} {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) {
      return { content: "", done: false, toolCalls: [] };
    }

    const content =
      isRecord(parsed.message) && typeof parsed.message.content === "string"
        ? parsed.message.content
        : "";

    return {
      content,
      done: parsed.done === true,
      toolCalls: isRecord(parsed.message) ? parseOllamaToolCalls(parsed.message.tool_calls) : [],
    };
  } catch {
    return { content: "", done: false, toolCalls: [] };
  }
}

function parseOllamaToolCalls(value: unknown): ChatToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).flatMap((toolCall, index) => {
    if (!isRecord(toolCall.function) || typeof toolCall.function.name !== "string") {
      return [];
    }

    return [
      {
        id: typeof toolCall.id === "string" ? toolCall.id : `call_${index}`,
        name: toolCall.function.name,
        arguments:
          isRecord(toolCall.function.arguments) ? toolCall.function.arguments : {},
      },
    ];
  });
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
