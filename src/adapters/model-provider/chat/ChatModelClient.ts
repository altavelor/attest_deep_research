import { ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { ProviderHttpClient } from "../common/http";
import { withLoggedErrors } from "../common/withLoggedErrors";
import {
  ChatCompletionsDialect,
  resolveChatCompletionsDialect,
} from "./streaming/chatCompletionsDialect";
import { listOpenAiCompatibleModelIds } from "./streaming/chatCompletionsHttp";
import { streamOpenAiCompatibleChat } from "./streaming/openAiChatStream";
import { RejectedFieldMemory } from "./streaming/optionalFieldRetry";

export interface ChatModelClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
  onReasoningObserved?: (observation: { protocol: "chat-completions"; dialect: string }) => void;
}

export class ChatModelClient implements ChatModelProvider {
  private readonly http: ProviderHttpClient;
  private readonly dialect: ChatCompletionsDialect;
  private readonly logger?: PluginRequestLogger;
  private readonly rejectedFields = new RejectedFieldMemory();
  private readonly onReasoningObserved?: ChatModelClientOptions["onReasoningObserved"];

  constructor(options: ChatModelClientOptions) {
    this.logger = options.logger;
    this.onReasoningObserved = options.onReasoningObserved;
    this.dialect = resolveChatCompletionsDialect(options.baseUrl);
    this.http = new ProviderHttpClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      defaultHeaders: this.dialect.requestHeaders,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      logger: options.logger,
      unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
      unavailableMessage: "The chat model provider is unavailable.",
    });
  }

  async listModels(): Promise<string[]> {
    return withLoggedErrors(() => listOpenAiCompatibleModelIds(this.http), this.logger);
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    try {
      yield* streamOpenAiCompatibleChat({
        http: this.http,
        request,
        dialect: this.dialect,
        onReasoningObserved: this.onReasoningObserved,
        rejectedFields: this.rejectedFields,
      });
    } catch (error) {
      this.logger?.logError(error);
      throw error;
    }
  }
}
