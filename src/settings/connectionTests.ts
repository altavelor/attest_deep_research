import { ChatModelClient } from "../client/chat/ChatModelClient";
import { EmbeddingClient } from "../client/embeddings/EmbeddingClient";
import { toUserMessage } from "../shared/errors";
import { ChatModelProvider, EmbeddingProviderClient, LocalModelProvider } from "../shared/types";
import { IxplorerSettings } from "./settings";

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  models: string[];
}

export interface ConnectionClientFactories {
  createChatClient(settings: IxplorerSettings): ChatModelProvider;
  createEmbeddingClient(settings: IxplorerSettings): EmbeddingProviderClient;
}

export const DEFAULT_CONNECTION_CLIENT_FACTORIES: ConnectionClientFactories = {
  createChatClient(settings) {
    return new ChatModelClient({
      provider: detectLocalModelProvider(settings.chatModelProviderBaseUrl),
      baseUrl: settings.chatModelProviderBaseUrl,
    });
  },
  createEmbeddingClient(settings) {
    return new EmbeddingClient({
      provider: detectLocalModelProvider(settings.embeddingProviderBaseUrl),
      baseUrl: settings.embeddingProviderBaseUrl,
    });
  },
};

export function detectLocalModelProvider(baseUrl: string): LocalModelProvider {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? "lmStudio" : "ollama";
}

export async function testChatConnection(
  settings: IxplorerSettings,
  factories: ConnectionClientFactories = DEFAULT_CONNECTION_CLIENT_FACTORIES,
): Promise<ConnectionTestResult> {
  try {
    const models = await factories.createChatClient(settings).listModels();
    const missingModel = getMissingConfiguredModel(settings.chatModel, models);

    if (missingModel) {
      return {
        ok: false,
        message: "The configured model is not available.",
        models,
      };
    }

    return {
      ok: true,
      message: modelCountMessage("chat provider", models.length),
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

export async function testEmbeddingConnection(
  settings: IxplorerSettings,
  factories: ConnectionClientFactories = DEFAULT_CONNECTION_CLIENT_FACTORIES,
): Promise<ConnectionTestResult> {
  try {
    const models = await factories.createEmbeddingClient(settings).listModels();
    const missingModel = getMissingConfiguredModel(settings.embeddingModel, models);

    if (missingModel) {
      return {
        ok: false,
        message: "The configured model is not available.",
        models,
      };
    }

    return {
      ok: true,
      message: modelCountMessage("embedding provider", models.length),
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

function getMissingConfiguredModel(
  configuredModel: string,
  availableModels: string[],
): string | null {
  const model = configuredModel.trim();

  if (!model) {
    return null;
  }

  return availableModels.includes(model) ? null : model;
}

function modelCountMessage(providerLabel: string, count: number): string {
  const plural = count === 1 ? "model" : "models";
  return `Connected to ${providerLabel}. Found ${count} ${plural}.`;
}
