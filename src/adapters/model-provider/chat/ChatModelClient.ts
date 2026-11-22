import type Anthropic from "@anthropic-ai/sdk";
import { Ollama } from "ollama";

import { ApiFormat, ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";
import { AttestError } from "@core/errors";
import { fetchTransportOrUnavailable } from "@shared";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { ProviderHttpClient } from "../common/http";
import { withLoggedErrors } from "../common/withLoggedErrors";
import {
  createAnthropicClient,
  createLoggingFetch,
  translateAnthropicError,
} from "./providers/anthropicSdk";
import {
  listOllamaModels,
  normalizeOllamaHost,
  streamOllamaChat,
} from "./streaming/ollamaChatStream";
import { streamAnthropicChat } from "./streaming/anthropicChatStream";
import {
  ChatCompletionsDialect,
  resolveChatCompletionsDialect,
} from "./streaming/chatCompletionsDialect";
import { listOpenAiCompatibleModelIds } from "./streaming/chatCompletionsHttp";
import { streamOpenAiCompatibleChat } from "./streaming/openAiChatStream";

export interface ChatModelClientOptions {
  apiFormat?: ApiFormat;
  provider?: ApiFormat | "lmStudio";
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
  onReasoningObserved?: (observation: { protocol: "chat-completions"; dialect: string }) => void;
}

export class ChatModelClient implements ChatModelProvider {
  private readonly provider: ApiFormat;
  private readonly http?: ProviderHttpClient;
  private readonly dialect: ChatCompletionsDialect;
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
    this.dialect = resolveChatCompletionsDialect(options.baseUrl);
    if (this.provider === "openai-compatible") {
      this.http = new ProviderHttpClient({
        apiFormat: "openai-compatible",
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        defaultHeaders: this.dialect.requestHeaders,
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
        logger: options.logger,
        unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
        unavailableMessage: "The chat model provider is unavailable.",
      });
    } else if (this.provider === "anthropic") {
      this.anthropic = createAnthropicClient(options);
    } else if (this.provider === "ollama") {
      this.ollama = new Ollama({
        host: normalizeOllamaHost(options.baseUrl),
        fetch: createLoggingFetch(fetchTransportOrUnavailable(options.fetch), {
          logger: options.logger,
        }),
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
            : listOpenAiCompatibleModelIds(this.http!),
      this.logger,
    );
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    try {
      if (this.provider === "ollama") {
        yield* streamOllamaChat({ ollama: this.ollama!, apiKey: this.apiKey, request });
      } else if (this.provider === "anthropic") {
        yield* streamAnthropicChat({
          anthropic: this.anthropic!,
          request,
          translateError: (error) => this.translateAnthropicError(error),
        });
      } else {
        yield* streamOpenAiCompatibleChat({
          http: this.http!,
          request,
          dialect: this.dialect,
          onReasoningObserved: this.onReasoningObserved,
        });
      }
    } catch (error) {
      this.logger?.logError(error);
      throw error;
    }
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
    return listOllamaModels(this.ollama!, this.apiKey);
  }

  private translateAnthropicError(error: unknown): AttestError {
    return translateAnthropicError(error, {
      unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
      unavailableMessage: "The chat model provider is unavailable.",
      apiKey: this.apiKey,
    });
  }
}

function normalizeApiFormat(value: ApiFormat | "lmStudio" | undefined): ApiFormat {
  return value === "lmStudio" || value === undefined ? "openai-compatible" : value;
}
