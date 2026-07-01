import { IxplorerError } from "../../../core/errors";
import { isRecord } from "../../../shared/guards";
import { ApiFormat, EmbeddingProviderClient, EmbeddingRequest, EmbeddingResponse } from "../../../core/agent/protocol";
import type { PluginRequestLogger } from "../../settings/debugLogger";
import { ProviderHttpClient } from "../common/http";
import { withLoggedErrors } from "../common/withLoggedErrors";
import {
  isOllamaTagsResponse,
  isOpenAiModelsResponse,
  modelNamesFromOllamaTags,
  modelNamesFromOpenAiModels,
} from "../common/models";

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

interface OllamaEmbedResponse {
  model?: string;
  embeddings: number[][];
}

export class EmbeddingClient implements EmbeddingProviderClient {
  private readonly provider: ApiFormat;
  private readonly http: ProviderHttpClient;
  private readonly logger?: PluginRequestLogger;

  constructor(options: EmbeddingClientOptions) {
    this.provider = normalizeApiFormat(options.apiFormat ?? options.provider);
    this.logger = options.logger;
    this.http = new ProviderHttpClient({
      ...options,
      apiFormat: this.provider,
      unavailableCode: "EMBEDDING_UNAVAILABLE",
      unavailableMessage: "The embedding provider is unavailable.",
    });
  }

  async listModels(): Promise<string[]> {
    return withLoggedErrors(
      () =>
        this.provider === "ollama" ? this.listOllamaModels() : this.listOpenAiCompatibleModels(),
      this.logger,
    );
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (this.provider === "anthropic") {
      throw new IxplorerError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "Anthropic embeddings are not supported.",
      });
    }

    return withLoggedErrors(
      () =>
        this.provider === "ollama"
          ? this.embedWithOllama(request)
          : this.embedWithOpenAiCompatible(request),
      this.logger,
    );
  }

  private async listOpenAiCompatibleModels(): Promise<string[]> {
    const response = await this.http.request("/models", { method: "GET" });
    const body = await this.http.readJson(
      response,
      "The embedding provider returned invalid JSON.",
    );

    if (!isOpenAiModelsResponse(body)) {
      throw new IxplorerError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "The OpenAI-compatible provider returned an invalid models response.",
      });
    }

    return modelNamesFromOpenAiModels(body);
  }

  private async listOllamaModels(): Promise<string[]> {
    const response = await this.http.request("/tags", { method: "GET" });
    const body = await this.http.readJson(
      response,
      "The embedding provider returned invalid JSON.",
    );

    if (!isOllamaTagsResponse(body)) {
      throw new IxplorerError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "Ollama returned an invalid tags response.",
      });
    }

    return modelNamesFromOllamaTags(body);
  }

  private async embedWithOpenAiCompatible(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await this.http.request("/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await this.http.readJson(
      response,
      "The embedding provider returned invalid JSON.",
    );

    if (!isOpenAiEmbeddingsResponse(body)) {
      throw new IxplorerError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "The OpenAI-compatible provider returned an invalid embeddings response.",
      });
    }

    return {
      model: body.model ?? request.model,
      embeddings: body.data.map((item) => item.embedding),
    };
  }

  private async embedWithOllama(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await this.http.request("/embed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = await this.http.readJson(
      response,
      "The embedding provider returned invalid JSON.",
    );

    if (!isOllamaEmbedResponse(body)) {
      throw new IxplorerError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "Ollama returned an invalid embeddings response.",
      });
    }

    return {
      model: body.model ?? request.model,
      embeddings: body.embeddings,
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

function normalizeApiFormat(value: ApiFormat | "lmStudio" | undefined): ApiFormat {
  return value === "lmStudio" || value === undefined ? "openai-compatible" : value;
}

function isOllamaEmbedResponse(value: unknown): value is OllamaEmbedResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.embeddings) &&
    value.embeddings.every(
      (embedding) =>
        Array.isArray(embedding) && embedding.every((dimension) => typeof dimension === "number"),
    )
  );
}
