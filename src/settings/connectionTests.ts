import { EmbeddingClient } from "../client/embeddings/EmbeddingClient";
import { ProviderHttpClient } from "../client/common/http";
import {
  isOllamaTagsResponse,
  isOpenAiModelsResponse,
  modelNamesFromOllamaTags,
  modelNamesFromOpenAiModels,
} from "../client/common/models";
import { toUserMessage } from "../shared/errors";
import { ApiFormat } from "../shared/types";
import type { PluginRequestLogger } from "./debugLogger";
import { ModelCapability, ServerProfile } from "./settings";

export interface DiscoveredModel {
  id: string;
  name: string;
  capabilities: ModelCapability;
}

export interface ModelDiscoveryResult {
  ok: boolean;
  message: string;
  models: DiscoveredModel[];
}

export interface ModelDiscoveryOptions {
  fetch?: typeof fetch;
  logger?: PluginRequestLogger;
  timeoutMs?: number;
}

export function apiFormatLabel(apiFormat: ApiFormat): string {
  switch (apiFormat) {
    case "anthropic":
      return "Anthropic";
    case "ollama":
      return "Ollama";
    case "openai-compatible":
      return "OpenAI-compatible";
  }
}

export async function fetchAvailableModels(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions = {},
): Promise<ModelDiscoveryResult> {
  try {
    const models =
      serverProfile.apiFormat === "ollama"
        ? await fetchOllamaModels(serverProfile, options)
        : serverProfile.apiFormat === "anthropic"
          ? await fetchAnthropicModels(serverProfile, options)
          : await fetchOpenAiCompatibleModels(serverProfile, options);

    return {
      ok: true,
      message: modelCountMessage(apiFormatLabel(serverProfile.apiFormat), models.length),
      models,
    };
  } catch (error) {
    return {
      ok: false,
      message: toUserMessage(error),
      models: [],
    };
  }
}

export async function verifyEmbeddingCapability(
  serverProfile: ServerProfile,
  modelName: string,
  options: ModelDiscoveryOptions = {},
): Promise<boolean> {
  if (serverProfile.apiFormat === "anthropic") {
    return false;
  }

  try {
    const client = new EmbeddingClient({
      apiFormat: serverProfile.apiFormat,
      baseUrl: serverProfile.baseUrl,
      apiKey: serverProfile.apiKey,
      fetch: options.fetch,
      logger: options.logger,
      timeoutMs: options.timeoutMs,
    });
    await client.embed({ model: modelName, input: ["capability probe"] });
    return true;
  } catch {
    return false;
  }
}

async function fetchOpenAiCompatibleModels(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions,
): Promise<DiscoveredModel[]> {
  const http = createDiscoveryHttp(serverProfile, options);
  const response = await http.request("/models", { method: "GET" });
  const body = await http.readJson(response, "The model provider returned invalid JSON.");

  if (!isOpenAiModelsResponse(body)) {
    throw new Error("The model provider returned an invalid models response.");
  }

  return modelNamesFromOpenAiModels(body).map((name) => ({
    id: name,
    name,
    capabilities: openAiCompatibleDefaultCapability(),
  }));
}

async function fetchAnthropicModels(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions,
): Promise<DiscoveredModel[]> {
  const http = createDiscoveryHttp(serverProfile, options);
  const response = await http.request("/models", {
    method: "GET",
    headers: { "anthropic-version": "2023-06-01" },
  });
  const body = await http.readJson(response, "Anthropic returned invalid JSON.");

  if (!isOpenAiModelsResponse(body)) {
    throw new Error("Anthropic returned an invalid models response.");
  }

  return modelNamesFromOpenAiModels(body).map((name) => ({
    id: name,
    name,
    capabilities: {
      chat: true,
      embeddings: false,
      temperature: true,
      maxTokens: true,
      detectionSource: "format-default",
    },
  }));
}

async function fetchOllamaModels(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions,
): Promise<DiscoveredModel[]> {
  const http = createDiscoveryHttp(serverProfile, options);
  const response = await http.request("/tags", { method: "GET" });
  const body = await http.readJson(response, "Ollama returned invalid JSON.");

  if (!isOllamaTagsResponse(body)) {
    throw new Error("Ollama returned an invalid tags response.");
  }

  return modelNamesFromOllamaTags(body).map((name) => ({
    id: name,
    name,
    capabilities: {
      chat: true,
      embeddings: true,
      temperature: true,
      maxTokens: true,
      detectionSource: "format-default",
    },
  }));
}

function createDiscoveryHttp(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions,
): ProviderHttpClient {
  return new ProviderHttpClient({
    apiFormat: serverProfile.apiFormat,
    baseUrl: serverProfile.baseUrl,
    apiKey: serverProfile.apiKey,
    fetch: options.fetch,
    logger: options.logger,
    timeoutMs: options.timeoutMs,
    unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
    unavailableMessage: "The model provider is unavailable.",
  });
}

function openAiCompatibleDefaultCapability(): ModelCapability {
  return {
    chat: true,
    embeddings: false,
    temperature: true,
    maxTokens: true,
    detectionSource: "format-default",
  };
}

function modelCountMessage(providerLabel: string, count: number): string {
  const plural = count === 1 ? "model" : "models";
  return `Connected to ${providerLabel}. Found ${count} ${plural}.`;
}
