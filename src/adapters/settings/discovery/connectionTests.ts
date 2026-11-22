import { EmbeddingClient } from "@adapters/model-provider/embeddings/EmbeddingClient";
import { contextLengthFromModelMetadata } from "@adapters/model-provider/common/models";
import { toUserMessage } from "@core/errors";
import { ApiFormat } from "@core/agent";
import { ModelCapability, ServerProfile } from "../types";
import type { ModelCapabilitySnapshot } from "../capabilities";
import { resolveCapabilityMetadata } from "../capabilities";
import { capabilityFromKinds, resolveProviderDialect } from "./providerDialects";
import type { ProviderDialect } from "./providerDialects";
import { genericOpenAiDialect } from "./providerDialects/flatDialects";
import { createDiscoveryHttp, ModelDiscoveryOptions } from "./discoveryHttp";
import { fetchOllamaContextLength, fetchOllamaModelNames } from "./ollamaMetadata";

export type { ModelDiscoveryOptions } from "./discoveryHttp";

export interface DiscoveredModel {
  id: string;
  name: string;
  capabilities: ModelCapability;
  capabilitySnapshot?: ModelCapabilitySnapshot;
}

export interface ModelDiscoveryResult {
  ok: boolean;
  message: string;
  models: DiscoveredModel[];
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

export function providerLabel(serverProfile: ServerProfile): string {
  return serverProfile.apiFormat === "openai-compatible"
    ? resolveProviderDialect(serverProfile.baseUrl).label
    : apiFormatLabel(serverProfile.apiFormat);
}

/**
 * Reports how many discovered models can serve the requested profile role,
 * because a provider listing usually mixes chat and embedding models.
 */
export function modelRoleCountMessage(
  serverProfile: ServerProfile,
  models: DiscoveredModel[],
  kind: "chat" | "embedding",
): string {
  const matching = models.filter((model) =>
    kind === "chat" ? model.capabilities.chat : model.capabilities.embeddings,
  ).length;
  const plural = matching === 1 ? "model" : "models";
  const role = kind === "chat" ? "chat" : "embedding";
  return `Connected to ${providerLabel(serverProfile)}. Found ${matching} ${role} ${plural} of ${models.length}.`;
}

export async function fetchAvailableModels(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions = {},
): Promise<ModelDiscoveryResult> {
  try {
    const models = await fetchOpenAiCompatibleModels(serverProfile, options);

    return {
      ok: true,
      message: modelCountMessage(providerLabel(serverProfile), models.length),
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
  if (resolveProviderDialect(serverProfile.baseUrl).embeddingsUnavailable) {
    return false;
  }

  try {
    const client = new EmbeddingClient({
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

export async function fetchModelContextLength(
  serverProfile: ServerProfile,
  modelName: string,
  options: ModelDiscoveryOptions = {},
): Promise<number | undefined> {
  const encodedModelName = encodeURIComponent(modelName);
  const standardMetadata = await tryFetchContextLength(
    serverProfile,
    `/models/${encodedModelName}`,
    options,
    { method: "GET" },
  );
  if (
    standardMetadata !== undefined ||
    resolveProviderDialect(serverProfile.baseUrl) !== genericOpenAiDialect
  ) {
    return standardMetadata;
  }

  const lmStudioBaseUrl = lmStudioMetadataBaseUrl(serverProfile.baseUrl);
  const lmStudioMetadata = lmStudioBaseUrl
    ? await tryFetchContextLength(
        { ...serverProfile, baseUrl: lmStudioBaseUrl },
        `/models/${encodedModelName}`,
        options,
        { method: "GET" },
      )
    : undefined;
  return lmStudioMetadata ?? fetchOllamaContextLength(serverProfile, modelName, options);
}

async function tryFetchContextLength(
  serverProfile: ServerProfile,
  path: string,
  options: ModelDiscoveryOptions,
  init: RequestInit,
): Promise<number | undefined> {
  try {
    const http = createDiscoveryHttp(serverProfile, options);
    const response = await http.request(path, init);
    const body = await http.readJson(
      response,
      "The model provider returned invalid metadata JSON.",
    );
    return contextLengthFromModelMetadata(body);
  } catch {
    return undefined;
  }
}

function lmStudioMetadataBaseUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? `${trimmed.slice(0, -3)}/api/v0` : undefined;
}

async function fetchOpenAiCompatibleModels(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions,
): Promise<DiscoveredModel[]> {
  const dialect = resolveProviderDialect(serverProfile.baseUrl);
  const http = createDiscoveryHttp(serverProfile, options);
  const discovered = new Map<string, DiscoveredModel>();

  for (const [index, path] of dialect.modelListPaths.entries()) {
    const isPrimaryList = index === 0;
    let entries: Record<string, unknown>[] | null;
    try {
      const response = await http.request(path, { method: "GET" });
      const body = await http.readJson(response, "The model provider returned invalid JSON.");
      entries = dialect.extractEntries(body);
    } catch (error) {
      if (isPrimaryList) {
        throw error;
      }
      continue;
    }

    if (entries === null) {
      if (isPrimaryList) {
        throw new Error("The model provider returned an invalid models response.");
      }
      continue;
    }

    for (const entry of entries) {
      const model = discoveredModelFrom(entry, dialect);
      if (!model) {
        continue;
      }

      const existing = discovered.get(model.id);
      discovered.set(model.id, existing ? mergeDiscoveredModels(existing, model) : model);
    }
  }

  return dialect === genericOpenAiDialect
    ? withOllamaKinds([...discovered.values()], await fetchOllamaModelNames(serverProfile, options))
    : [...discovered.values()];
}

/** Marks every model the Ollama tag listing names as chat and embedding capable, as the native listing does. */
function withOllamaKinds(
  models: DiscoveredModel[],
  ollamaNames: Set<string> | undefined,
): DiscoveredModel[] {
  if (!ollamaNames) {
    return models;
  }

  return models.map((model) =>
    ollamaNames.has(model.id)
      ? {
          ...model,
          capabilities: {
            ...model.capabilities,
            ...capabilityFromKinds({ chat: true, embeddings: true }),
          },
        }
      : model,
  );
}

function discoveredModelFrom(
  entry: Record<string, unknown>,
  dialect: ProviderDialect,
): DiscoveredModel | undefined {
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) {
    return undefined;
  }

  const contextLength = contextLengthFromModelMetadata(entry);
  const capabilitySnapshot = resolveCapabilityMetadata(entry);
  return {
    id,
    name: id,
    capabilities: {
      ...capabilityFromKinds(dialect.detectKinds(entry)),
      ...(contextLength !== undefined
        ? { contextLength, detectionSource: "metadata" as const }
        : {}),
    },
    ...(capabilitySnapshot ? { capabilitySnapshot } : {}),
  };
}

function mergeDiscoveredModels(
  existing: DiscoveredModel,
  incoming: DiscoveredModel,
): DiscoveredModel {
  const contextLength = existing.capabilities.contextLength ?? incoming.capabilities.contextLength;
  const detectionSource =
    existing.capabilities.contextLength === undefined && contextLength !== undefined
      ? incoming.capabilities.detectionSource
      : existing.capabilities.detectionSource;

  return {
    ...existing,
    capabilities: {
      ...existing.capabilities,
      chat: existing.capabilities.chat || incoming.capabilities.chat,
      embeddings: existing.capabilities.embeddings || incoming.capabilities.embeddings,
      contextLength,
      detectionSource,
    },
    capabilitySnapshot: existing.capabilitySnapshot ?? incoming.capabilitySnapshot,
  };
}

function modelCountMessage(providerLabel: string, count: number): string {
  const plural = count === 1 ? "model" : "models";
  return `Connected to ${providerLabel}. Found ${count} ${plural}.`;
}
