import { IxplorerError } from "../../shared/errors";
import { isRecord } from "../../shared/guards";
import {
  ApiFormat,
  ChatModelProvider,
  ChatRequest,
  ChatResponseChunk,
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
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
      }),
    });

    if (!response.body) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "The OpenAI-compatible provider returned an empty chat stream.",
      });
    }

    for await (const event of parseServerSentEvents(response.body)) {
      if (event === "[DONE]") {
        yield { content: "", isComplete: true };
        return;
      }

      const content = parseOpenAiChatDelta(event);
      if (content) {
        yield { content, isComplete: false };
      }
    }

    yield { content: "", isComplete: true };
  }

  private async *streamAnthropicChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    const systemMessage = request.messages.find((message) => message.role === "system")?.content;
    const messages = request.messages.filter((message) => message.role !== "system");
    const response = await this.http.request("/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: request.model,
        messages,
        system: systemMessage || undefined,
        temperature: request.temperature,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!response.body) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "Anthropic returned an empty chat stream.",
      });
    }

    for await (const event of parseServerSentEvents(response.body)) {
      const content = parseAnthropicChatDelta(event);
      if (content) {
        yield { content, isComplete: false };
      }
    }

    yield { content: "", isComplete: true };
  }

  private async *streamOllamaChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    const response = await this.http.request("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        options:
          request.temperature === undefined && request.maxTokens === undefined
            ? undefined
            : { temperature: request.temperature, num_predict: request.maxTokens },
      }),
    });

    if (!response.body) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "Ollama returned an empty chat stream.",
      });
    }

    for await (const line of parseJsonLines(response.body)) {
      const parsed = parseOllamaChatLine(line);
      if (parsed.content) {
        yield { content: parsed.content, isComplete: false };
      }

      if (parsed.done) {
        yield { content: "", isComplete: true };
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

function parseOpenAiChatDelta(event: string): string {
  try {
    const parsed: unknown = JSON.parse(event);
    if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
      return "";
    }

    const firstChoice: unknown = parsed.choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
      return "";
    }

    return typeof firstChoice.delta.content === "string" ? firstChoice.delta.content : "";
  } catch {
    return "";
  }
}

function normalizeApiFormat(value: ApiFormat | "lmStudio" | undefined): ApiFormat {
  return value === "lmStudio" || value === undefined ? "openai-compatible" : value;
}

function parseAnthropicChatDelta(event: string): string {
  try {
    const parsed: unknown = JSON.parse(event);
    if (!isRecord(parsed) || parsed.type !== "content_block_delta" || !isRecord(parsed.delta)) {
      return "";
    }

    return parsed.delta.type === "text_delta" && typeof parsed.delta.text === "string"
      ? parsed.delta.text
      : "";
  } catch {
    return "";
  }
}

function parseOllamaChatLine(line: string): { content: string; done: boolean } {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) {
      return { content: "", done: false };
    }

    const content =
      isRecord(parsed.message) && typeof parsed.message.content === "string"
        ? parsed.message.content
        : "";

    return { content, done: parsed.done === true };
  } catch {
    return { content: "", done: false };
  }
}
