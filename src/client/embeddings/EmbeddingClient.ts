import { IxplorerError } from "../../shared/errors";
import {
  EmbeddingProviderClient,
  EmbeddingRequest,
  EmbeddingResponse,
  LocalModelProvider,
} from "../../shared/types";
import { ProviderHttpClient } from "../common/http";
import {
  isOllamaTagsResponse,
  isOpenAiModelsResponse,
  isRecord,
  modelNamesFromOllamaTags,
  modelNamesFromOpenAiModels,
} from "../common/models";

export interface EmbeddingClientOptions {
  provider: LocalModelProvider;
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
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
  private readonly provider: LocalModelProvider;
  private readonly http: ProviderHttpClient;

  constructor(options: EmbeddingClientOptions) {
    this.provider = options.provider;
    this.http = new ProviderHttpClient({
      ...options,
      unavailableCode: "EMBEDDING_UNAVAILABLE",
      unavailableMessage: "The embedding provider is unavailable.",
    });
  }

  async listModels(): Promise<string[]> {
    return this.provider === "lmStudio" ? this.listLmStudioModels() : this.listOllamaModels();
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.provider === "lmStudio"
      ? this.embedWithLmStudio(request)
      : this.embedWithOllama(request);
  }

  private async listLmStudioModels(): Promise<string[]> {
    const response = await this.http.request("/models", { method: "GET" });
    const body = await this.http.readJson(
      response,
      "The embedding provider returned invalid JSON.",
    );

    if (!isOpenAiModelsResponse(body)) {
      throw new IxplorerError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "LM Studio returned an invalid models response.",
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

  private async embedWithLmStudio(request: EmbeddingRequest): Promise<EmbeddingResponse> {
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
        message: "LM Studio returned an invalid embeddings response.",
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
