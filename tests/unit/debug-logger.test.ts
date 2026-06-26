import { PluginDebugLogger } from "../../src/adapters/settings/debugLogger";
import { DEFAULT_SETTINGS, IxplorerSettings } from "../../src/adapters/settings/settings";
import { IxplorerError } from "../../src/core/errors";

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

  it("logs probe results, redacting secrets, only when debug mode is enabled", () => {
    const debug = vi.fn();
    const error = vi.fn();
    let debugMode = false;
    const logger = new PluginDebugLogger({
      getSettings: () => createSettings({ debugMode }),
      console: { debug, error },
    });

    const context = {
      probe: "tool-capabilities",
      profileId: "chat-qwen",
      model: "qwen3",
      received: { calls: true, apiKey: "secret-key" },
      saved: { tools: true },
    };

    logger.logProbeResult(context);
    expect(debug).not.toHaveBeenCalled();

    debugMode = true;
    logger.logProbeResult(context);

    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith("[Ixplorer] Probe result", {
      probe: "tool-capabilities",
      profileId: "chat-qwen",
      model: "qwen3",
      received: { calls: true, apiKey: "[redacted]" },
      saved: { tools: true },
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("logs the plugin configuration only when debug mode is enabled", () => {
    const debug = vi.fn();
    const error = vi.fn();
    const logger = new PluginDebugLogger({
      getSettings: () => createSettings(),
      console: { debug, error },
    });

    logger.logConfiguration("initial-load", createSettings({ debugMode: false }));
    expect(debug).not.toHaveBeenCalled();

    logger.logConfiguration("initial-load", createSettings({ debugMode: true }));
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(
      "[Ixplorer] Configuration",
      expect.objectContaining({
        stage: "initial-load",
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
