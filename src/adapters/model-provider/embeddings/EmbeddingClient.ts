import { AttestError } from "@core/errors";
import { isRecord } from "@shared";
import {
  ApiFormat,
  EmbeddingProviderClient,
  EmbeddingRequest,
  EmbeddingResponse,
} from "@core/agent";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { ProviderHttpClient } from "../common/http";
import { withLoggedErrors } from "../common/withLoggedErrors";
import { isOpenAiModelsResponse, modelNamesFromOpenAiModels } from "../common/models";

export interface EmbeddingClientOptions {
  apiFormat?: ApiFormat;
  provider?: ApiFormat | "lmStudio";
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
}

interface OpenAiEmbeddingsResponse {
  model?: string;
  data: Array<{ embedding: number[] }>;
}

export class EmbeddingClient implements EmbeddingProviderClient {
  private readonly http: ProviderHttpClient;
  private readonly logger?: PluginRequestLogger;

  constructor(options: EmbeddingClientOptions) {
    this.logger = options.logger;
    this.http = new ProviderHttpClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      logger: options.logger,
      unavailableCode: "EMBEDDING_UNAVAILABLE",
      unavailableMessage: "The embedding provider is unavailable.",
    });
  }

  async listModels(): Promise<string[]> {
    return withLoggedErrors(() => this.listOpenAiCompatibleModels(), this.logger);
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return withLoggedErrors(() => this.embedWithOpenAiCompatible(request), this.logger);
  }

  private async listOpenAiCompatibleModels(): Promise<string[]> {
    const response = await this.http.request("/models", { method: "GET" });
    const body = await this.http.readJson(
      response,
      "The embedding provider returned invalid JSON.",
    );

    if (!isOpenAiModelsResponse(body)) {
      throw new AttestError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "The OpenAI-compatible provider returned an invalid models response.",
      });
    }

    return modelNamesFromOpenAiModels(body);
  }

  private async embedWithOpenAiCompatible(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await this.http.request("/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: request.model, input: request.input }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const body = await this.http.readJson(
      response,
      "The embedding provider returned invalid JSON.",
    );

    if (!isOpenAiEmbeddingsResponse(body)) {
      throw new AttestError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "The OpenAI-compatible provider returned an invalid embeddings response.",
      });
    }

    return {
      model: body.model ?? request.model,
      embeddings: body.data.map((item) => item.embedding),
    };
  }
}

function isOpenAiEmbeddingsResponse(value: unknown): value is OpenAiEmbeddingsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every(
      (item) =>
        isRecord(item) &&
        Array.isArray(item.embedding) &&
        item.embedding.every((dimension) => typeof dimension === "number"),
    )
  );
}
