import {
  apiFormatLabel,
  fetchAvailableModels,
  verifyEmbeddingCapability,
} from "../../src/settings/connectionTests";
import { ServerProfile } from "../../src/settings/settings";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

function server(overrides: Partial<ServerProfile>): ServerProfile {
  return {
    id: "server-a",
    name: "Server A",
    apiFormat: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("model discovery", () => {
  it("formats API format labels", () => {
    expect(apiFormatLabel("openai-compatible")).toBe("OpenAI-compatible");
    expect(apiFormatLabel("ollama")).toBe("Ollama");
    expect(apiFormatLabel("anthropic")).toBe("Anthropic");
  });

  it("fetches OpenAI-compatible chat models with default capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "qwen3" }] }));

    const result = await fetchAvailableModels(server({}), { fetch: fetchMock });

    expect(result).toEqual({
      ok: true,
      message: "Connected to OpenAI-compatible. Found 1 model.",
      models: [
        {
          id: "qwen3",
          name: "qwen3",
          capabilities: {
            chat: true,
            embeddings: false,
            temperature: true,
            maxTokens: true,
            detectionSource: "format-default",
          },
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/models", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("fetches Ollama models as chat and embedding capable by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ models: [{ name: "embeddinggemma" }] }));

    const result = await fetchAvailableModels(
      server({ apiFormat: "ollama", baseUrl: "http://localhost:11434" }),
      { fetch: fetchMock },
    );

    expect(result.models[0]).toMatchObject({
      id: "embeddinggemma",
      capabilities: { chat: true, embeddings: true },
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/tags", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("fetches Anthropic models as chat-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "claude-sonnet" }] }));

    const result = await fetchAvailableModels(
      server({ apiFormat: "anthropic", baseUrl: "https://api.anthropic.com/v1" }),
      { fetch: fetchMock },
    );

    expect(result.models[0]).toMatchObject({
      id: "claude-sonnet",
      capabilities: { chat: true, embeddings: false, maxTokens: true },
    });
  });

  it("reports fetch failures without returning models", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await fetchAvailableModels(server({}), { fetch: fetchMock });

    expect(result).toMatchObject({
      ok: false,
      message: "The local model provider is unavailable.",
      models: [],
    });
  });

  it("verifies embedding capability with a smoke embedding request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        model: "text-embedding",
        data: [{ embedding: [0.1, 0.2] }],
      }),
    );

    await expect(
      verifyEmbeddingCapability(server({}), "text-embedding", { fetch: fetchMock }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not verify Anthropic embedding capability", async () => {
    const fetchMock = vi.fn();

    await expect(
      verifyEmbeddingCapability(
        server({ apiFormat: "anthropic", baseUrl: "https://api.anthropic.com/v1" }),
        "claude-sonnet",
        { fetch: fetchMock },
      ),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
