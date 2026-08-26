import {
  apiFormatLabel,
  fetchAvailableModels,
  fetchModelContextLength,
  modelRoleCountMessage,
  verifyEmbeddingCapability,
} from "@adapters/settings";
import { ServerProfile } from "@adapters/settings";

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

  it("uses context metadata returned by an OpenAI-compatible models endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: "qwen3", max_context_length: 32768 }] }));

    const result = await fetchAvailableModels(server({}), { fetch: fetchMock });

    expect(result.models[0]?.capabilities).toMatchObject({
      contextLength: 32768,
      detectionSource: "metadata",
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

  it("discovers OpenRouter embedding models from the modality-filtered listing", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("output_modalities=embeddings")
        ? jsonResponse({
            data: [
              {
                id: "nvidia/nemotron-3-embed-1b",
                architecture: { modality: "text->embeddings", output_modalities: ["embeddings"] },
              },
            ],
          })
        : jsonResponse({
            data: [
              {
                id: "openai/gpt-5",
                architecture: { modality: "text->text", output_modalities: ["text"] },
                context_length: 400000,
              },
            ],
          }),
    );

    const result = await fetchAvailableModels(server({ baseUrl: "https://openrouter.ai/api/v1" }), {
      fetch: fetchMock,
    });

    expect(result.message).toBe("Connected to OpenRouter. Found 2 models.");
    expect(result.models.map((model) => [model.id, model.capabilities.embeddings])).toEqual([
      ["openai/gpt-5", false],
      ["nvidia/nemotron-3-embed-1b", true],
    ]);
    expect(result.models[0]?.capabilities).toMatchObject({ chat: true, contextLength: 400000 });
    expect(result.models[1]?.capabilities).toMatchObject({ chat: false, embeddings: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/models?output_modalities=embeddings",
    ]);
  });

  it("carries advertised reasoning efforts from an OpenRouter listing into the snapshot", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("output_modalities=embeddings")
        ? jsonResponse({ data: [] })
        : jsonResponse({
            data: [
              {
                id: "qwen/qwen3.8-2.4t-a95b",
                architecture: { output_modalities: ["text"] },
                supported_parameters: ["tools", "reasoning", "reasoning_effort"],
                reasoning: {
                  mandatory: true,
                  default_enabled: true,
                  supported_efforts: ["xhigh", "medium", "low"],
                  default_effort: "xhigh",
                },
              },
            ],
          }),
    );

    const result = await fetchAvailableModels(server({ baseUrl: "https://openrouter.ai/api/v1" }), {
      fetch: fetchMock,
    });

    expect(result.models[0]?.capabilitySnapshot?.reasoning).toMatchObject({
      efforts: ["xhigh", "medium", "low"],
      defaultEffort: "xhigh",
    });
    expect(result.models[0]?.capabilitySnapshot?.tools).toBe("supported");
  });

  it("keeps the primary listing when a supplementary listing fails", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("output_modalities=embeddings")
        ? Promise.reject(new TypeError("fetch failed"))
        : jsonResponse({ data: [{ id: "openai/gpt-5" }] }),
    );

    const result = await fetchAvailableModels(server({ baseUrl: "https://openrouter.ai/api/v1" }), {
      fetch: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(result.models.map((model) => model.id)).toEqual(["openai/gpt-5"]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/models?output_modalities=embeddings",
    ]);
  });

  it("merges a model listed by both OpenRouter listings into one entry", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("output_modalities=embeddings")
        ? jsonResponse({
            data: [
              {
                id: "nvidia/nemotron-3-embed-1b",
                architecture: { output_modalities: ["embeddings"] },
              },
            ],
          })
        : jsonResponse({
            data: [
              {
                id: "nvidia/nemotron-3-embed-1b",
                architecture: { output_modalities: ["text"] },
                context_length: 8192,
              },
            ],
          }),
    );

    const result = await fetchAvailableModels(server({ baseUrl: "https://openrouter.ai/api/v1" }), {
      fetch: fetchMock,
    });

    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.capabilities).toMatchObject({
      chat: true,
      embeddings: true,
      contextLength: 8192,
      detectionSource: "metadata",
    });
  });

  it("keeps context metadata found only in the supplementary listing as metadata-sourced", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("output_modalities=embeddings")
        ? jsonResponse({ data: [{ id: "voyage-4", context_length: 32000 }] })
        : jsonResponse({ data: [{ id: "voyage-4" }] }),
    );

    const result = await fetchAvailableModels(server({ baseUrl: "https://openrouter.ai/api/v1" }), {
      fetch: fetchMock,
    });

    expect(result.models[0]?.capabilities).toMatchObject({
      contextLength: 32000,
      detectionSource: "metadata",
    });
  });

  it("keeps the primary listing when a supplementary listing is malformed", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("output_modalities=embeddings")
        ? jsonResponse({ data: "nope" })
        : jsonResponse({ data: [{ id: "openai/gpt-5" }] }),
    );

    const result = await fetchAvailableModels(server({ baseUrl: "https://openrouter.ai/api/v1" }), {
      fetch: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(result.models.map((model) => model.id)).toEqual(["openai/gpt-5"]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/models?output_modalities=embeddings",
    ]);
  });

  it("skips listing entries without a usable model id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: "" }, { name: "llama" }, { id: "  ok  " }] }));

    const result = await fetchAvailableModels(server({}), { fetch: fetchMock });

    expect(result.models.map((model) => model.id)).toEqual(["ok"]);
  });

  it("names the recognised provider in the connection message", async () => {
    const openAiCompatible = vi.fn(async () => jsonResponse({ data: [{ id: "qwen3" }] }));
    const ollama = vi.fn(async () => jsonResponse({ models: [{ name: "gemma" }] }));
    const anthropic = vi.fn(async () => jsonResponse({ data: [{ id: "claude" }] }));

    await expect(
      fetchAvailableModels(server({ baseUrl: "https://api.groq.com/openai/v1" }), {
        fetch: openAiCompatible,
      }),
    ).resolves.toMatchObject({ message: "Connected to Groq. Found 1 model." });
    await expect(
      fetchAvailableModels(server({}), { fetch: openAiCompatible }),
    ).resolves.toMatchObject({ message: "Connected to OpenAI-compatible. Found 1 model." });
    await expect(
      fetchAvailableModels(server({ apiFormat: "ollama", baseUrl: "http://localhost:11434" }), {
        fetch: ollama,
      }),
    ).resolves.toMatchObject({ message: "Connected to Ollama. Found 1 model." });
    await expect(
      fetchAvailableModels(
        server({ apiFormat: "anthropic", baseUrl: "https://api.anthropic.com/v1" }),
        { fetch: anthropic },
      ),
    ).resolves.toMatchObject({ message: "Connected to Anthropic. Found 1 model." });
  });

  it("counts only the models usable for the requested profile role", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("output_modalities=embeddings")
        ? jsonResponse({
            data: [
              { id: "voyage-4", architecture: { output_modalities: ["embeddings"] } },
              { id: "nemotron-embed", architecture: { output_modalities: ["embeddings"] } },
            ],
          })
        : jsonResponse({
            data: [
              { id: "openai/gpt-5", architecture: { output_modalities: ["text"] } },
              { id: "anthropic/claude", architecture: { output_modalities: ["text"] } },
              { id: "google/gemini", architecture: { output_modalities: ["text"] } },
            ],
          }),
    );
    const serverProfile = server({ baseUrl: "https://openrouter.ai/api/v1" });

    const result = await fetchAvailableModels(serverProfile, { fetch: fetchMock });

    expect(modelRoleCountMessage(serverProfile, result.models, "embedding")).toBe(
      "Connected to OpenRouter. Found 2 embedding models of 5.",
    );
    expect(modelRoleCountMessage(serverProfile, result.models, "chat")).toBe(
      "Connected to OpenRouter. Found 3 chat models of 5.",
    );
  });

  it("uses the singular form for a single model of the requested role", () => {
    const serverProfile = server({});
    const models = [
      {
        id: "text-embedding",
        name: "text-embedding",
        capabilities: {
          chat: false,
          embeddings: true,
          detectionSource: "format-default" as const,
        },
      },
    ];

    expect(modelRoleCountMessage(serverProfile, models, "embedding")).toBe(
      "Connected to OpenAI-compatible. Found 1 embedding model of 1.",
    );
    expect(modelRoleCountMessage(serverProfile, models, "chat")).toBe(
      "Connected to OpenAI-compatible. Found 0 chat models of 1.",
    );
  });

  it("reports an invalid primary models listing as a failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ models: "nope" }));

    const result = await fetchAvailableModels(server({}), { fetch: fetchMock });

    expect(result).toMatchObject({ ok: false, models: [] });
  });

  it("marks self-hosted embedding models by name so they can be selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: "text-embedding-nomic-v1.5" }] }));

    const result = await fetchAvailableModels(server({}), { fetch: fetchMock });

    expect(result.models[0]?.capabilities).toMatchObject({ chat: false, embeddings: true });
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
      message:
        "The model provider is unavailable. Could not reach http://localhost:1234/v1/models (fetch failed).",
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

  it("fetches context metadata for a selected Ollama model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ model_info: { "llama.context_length": 131072 } }));

    await expect(
      fetchModelContextLength(
        server({ apiFormat: "ollama", baseUrl: "http://localhost:11434" }),
        "qwen3:latest",
        { fetch: fetchMock },
      ),
    ).resolves.toBe(131072);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/show", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen3:latest" }),
      signal: expect.any(AbortSignal),
    });
  });

  it("fetches context metadata from an OpenAI-compatible model resource", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ context_window: 65536 }));

    await expect(fetchModelContextLength(server({}), "qwen3", { fetch: fetchMock })).resolves.toBe(
      65536,
    );
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/models/qwen3", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("falls back to LM Studio native model metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ max_context_length: 32768 }));

    await expect(fetchModelContextLength(server({}), "qwen3", { fetch: fetchMock })).resolves.toBe(
      32768,
    );
    expect(fetchMock).toHaveBeenLastCalledWith("http://localhost:1234/api/v0/models/qwen3", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("returns no context metadata when an Ollama detail request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      fetchModelContextLength(
        server({ apiFormat: "ollama", baseUrl: "http://localhost:11434" }),
        "qwen3:latest",
        { fetch: fetchMock },
      ),
    ).resolves.toBeUndefined();
  });
});
