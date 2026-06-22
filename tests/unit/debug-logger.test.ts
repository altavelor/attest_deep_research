import { PluginDebugLogger } from "../../src/settings/debugLogger";
import { DEFAULT_SETTINGS, IxplorerSettings } from "../../src/settings/settings";
import { IxplorerError } from "../../src/shared/errors";

function createSettings(overrides: Partial<IxplorerSettings> = {}): IxplorerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

describe("PluginDebugLogger", () => {
  it("logs requests and responses only when debug mode is enabled", () => {
    const debug = vi.fn();
    const error = vi.fn();
    const logger = new PluginDebugLogger({
      getSettings: () =>
        createSettings({
          debugMode: true,
          chatModelProfiles: [
            {
              id: "chat-qwen",
              name: "Qwen",
              serverProfileId: "server-a",
              modelName: "qwen3",
              toolsEnabled: true,
              noteMutationAccess: false,
              reasoning: { mode: "off", summary: "off" },
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      console: { debug, error },
    });

    logger.logRequest({
      url: "http://localhost:1234/v1/models",
      method: "GET",
    });
    logger.logResponse({
      url: "http://localhost:1234/v1/models",
      method: "GET",
      status: 200,
      statusText: "OK",
    });

    expect(debug).toHaveBeenCalledTimes(2);
    expect(debug.mock.calls[0][1]).toMatchObject({
      url: "http://localhost:1234/v1/models",
      method: "GET",
      settings: expect.objectContaining({ debugMode: true }),
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("does not log successful requests when debug mode is disabled", () => {
    const debug = vi.fn();
    const error = vi.fn();
    const logger = new PluginDebugLogger({
      getSettings: () => createSettings({ debugMode: false }),
      console: { debug, error },
    });

    logger.logRequest({ url: "http://localhost:1234/v1/models", method: "GET" });
    logger.logResponse({
      url: "http://localhost:1234/v1/models",
      method: "GET",
      status: 200,
      statusText: "OK",
    });

    expect(debug).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("logs indexing file decisions only when debug mode is enabled", () => {
    const debug = vi.fn();
    const error = vi.fn();
    const logger = new PluginDebugLogger({
      getSettings: () => createSettings({ debugMode: true }),
      console: { debug, error },
    });

    logger.logIndexingFile({
      path: "Research/a.md",
      outcome: "indexed",
      reason: "indexed",
      modifiedTime: 42,
      chunkCount: 3,
    });

    expect(debug).toHaveBeenCalledWith(
      "[Ixplorer] Indexing file",
      expect.objectContaining({
        path: "Research/a.md",
        outcome: "indexed",
        reason: "indexed",
        chunkCount: 3,
        settings: expect.objectContaining({ debugMode: true }),
      }),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("always logs errors with current plugin settings", () => {
    const debug = vi.fn();
    const error = vi.fn();
    const logger = new PluginDebugLogger({
      getSettings: () =>
        createSettings({
          debugMode: false,
          embeddingModelProfiles: [
            {
              id: "embed-nomic",
              name: "Nomic",
              serverProfileId: "server-a",
              modelName: "nomic",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      console: { debug, error },
    });

    logger.logError(
      new IxplorerError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "Embedding provider failed.",
      }),
      {
        url: "http://localhost:11434/api/embed",
        method: "POST",
      },
    );

    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][1]).toMatchObject({
      context: {
        url: "http://localhost:11434/api/embed",
        method: "POST",
      },
      error: {
        code: "EMBEDDING_UNAVAILABLE",
        message: "Embedding provider failed.",
      },
      settings: expect.objectContaining({ debugMode: false }),
    });
  });
});
