import {
  ConnectionClientFactories,
  detectLocalModelProvider,
  localModelProviderLabel,
  refreshChatModels,
  refreshEmbeddingModels,
  testChatConnection,
  testEmbeddingConnection,
} from "../../src/settings/connectionTests";
import { DEFAULT_SETTINGS, IxplorerSettings } from "../../src/settings/settings";
import { IxplorerError } from "../../src/shared/errors";

function settings(overrides: Partial<IxplorerSettings>): IxplorerSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function factories(options: {
  chatModels?: string[];
  embeddingModels?: string[];
  chatError?: unknown;
  embeddingError?: unknown;
}): ConnectionClientFactories {
  return {
    createChatClient: () => ({
      listModels: async () => {
        if (options.chatError) {
          throw options.chatError;
        }
        return options.chatModels ?? [];
      },
      streamChat: () => {
        throw new Error("streamChat is not used by connection tests");
      },
    }),
    createEmbeddingClient: () => ({
      listModels: async () => {
        if (options.embeddingError) {
          throw options.embeddingError;
        }
        return options.embeddingModels ?? [];
      },
      embed: async () => {
        throw new Error("embed is not used by connection tests");
      },
    }),
  };
}

describe("connection tests", () => {
  it("detects LM Studio from OpenAI-compatible /v1 URLs", () => {
    expect(detectLocalModelProvider("http://localhost:1234/v1")).toBe("lmStudio");
    expect(detectLocalModelProvider("http://localhost:1234/v1/")).toBe("lmStudio");
  });

  it("detects Ollama from root or /api URLs", () => {
    expect(detectLocalModelProvider("http://localhost:11434")).toBe("ollama");
    expect(detectLocalModelProvider("http://localhost:11434/api")).toBe("ollama");
  });

  it("formats provider display labels", () => {
    expect(localModelProviderLabel("lmStudio")).toBe("LM Studio");
    expect(localModelProviderLabel("ollama")).toBe("Ollama");
  });

  it("refreshes chat models without validating the configured model", async () => {
    const result = await refreshChatModels(
      settings({ chatModelProviderBaseUrl: "http://localhost:1234/v1", chatModel: "missing" }),
      factories({ chatModels: ["qwen3"] }),
    );

    expect(result).toEqual({
      ok: true,
      message: "Connected to chat provider. Found 1 model.",
      models: ["qwen3"],
    });
  });

  it("refreshes embedding models without validating the configured model", async () => {
    const result = await refreshEmbeddingModels(
      settings({
        embeddingProviderBaseUrl: "http://localhost:11434",
        embeddingModel: "missing",
      }),
      factories({ embeddingModels: ["embeddinggemma"] }),
    );

    expect(result).toEqual({
      ok: true,
      message: "Connected to embedding provider. Found 1 model.",
      models: ["embeddinggemma"],
    });
  });

  it("reports successful chat connection with configured model", async () => {
    const result = await testChatConnection(
      settings({ chatModelProviderBaseUrl: "http://localhost:1234/v1", chatModel: "qwen3" }),
      factories({ chatModels: ["qwen3", "gemma"] }),
    );

    expect(result).toEqual({
      ok: true,
      message: "Connected to chat provider. Found 2 models.",
      models: ["qwen3", "gemma"],
    });
  });

  it("reports missing configured chat model", async () => {
    const result = await testChatConnection(
      settings({ chatModelProviderBaseUrl: "http://localhost:1234/v1", chatModel: "missing" }),
      factories({ chatModels: ["qwen3"] }),
    );

    expect(result).toEqual({
      ok: false,
      message: "The configured model is not available.",
      models: ["qwen3"],
    });
  });

  it("reports successful embedding connection with configured model", async () => {
    const result = await testEmbeddingConnection(
      settings({
        embeddingProviderBaseUrl: "http://localhost:11434",
        embeddingModel: "embeddinggemma",
      }),
      factories({ embeddingModels: ["embeddinggemma"] }),
    );

    expect(result).toEqual({
      ok: true,
      message: "Connected to embedding provider. Found 1 model.",
      models: ["embeddinggemma"],
    });
  });

  it("maps provider failures to user-safe messages", async () => {
    const result = await testEmbeddingConnection(
      settings({ embeddingProviderBaseUrl: "http://localhost:11434" }),
      factories({
        embeddingError: new IxplorerError({ code: "EMBEDDING_UNAVAILABLE" }),
      }),
    );

    expect(result).toEqual({
      ok: false,
      message: "The embedding provider is unavailable.",
      models: [],
    });
  });
});
