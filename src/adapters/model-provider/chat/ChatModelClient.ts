import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { Ollama } from "ollama";

import { ApiFormat, ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";
import { AttestError } from "@core/errors";
import { fetchTransportOrUnavailable } from "@shared";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { withLoggedErrors } from "../common/withLoggedErrors";
import {
  createAnthropicClient,
  createLoggingFetch,
  translateAnthropicError,
} from "./providers/anthropicSdk";
import { createOpenAiClient, translateOpenAiError } from "./providers/openAiSdk";
import {
  listOllamaModels,
  normalizeOllamaHost,
  streamOllamaChat,
} from "./streaming/ollamaChatStream";
import { streamAnthropicChat } from "./streaming/anthropicChatStream";
import { streamOpenAiCompatibleChat } from "./streaming/openAiChatStream";

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
    if (this.provider === "openai-compatible") {
      this.openai = createOpenAiClient(options);
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
            : this.listOpenAiCompatibleModels(),
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
          openai: this.openai!,
          request,
          translateError: (error) => this.translateOpenAiError(error),
          onReasoningObserved: this.onReasoningObserved,
        });
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

  private translateOpenAiError(error: unknown): AttestError {
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
