import { EmbeddingClient } from "../../src/client/embeddings/EmbeddingClient";
import { IxplorerError } from "../../src/shared/errors";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("EmbeddingClient", () => {
  it("lists LM Studio model ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: "text-embedding" }, { id: "qwen3" }],
      }),
    );
    const client = new EmbeddingClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(client.listModels()).resolves.toEqual(["text-embedding", "qwen3"]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/models", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("lists Ollama model names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        models: [{ name: "embeddinggemma" }, { model: "qwen3-embedding" }],
      }),
    );
    const client = new EmbeddingClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      fetch: fetchMock,
    });

    await expect(client.listModels()).resolves.toEqual(["embeddinggemma", "qwen3-embedding"]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/tags", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("requests LM Studio OpenAI-compatible embeddings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        model: "text-embedding",
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      }),
    );
    const client = new EmbeddingClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(
      client.embed({ model: "text-embedding", input: ["first", "second"] }),
    ).resolves.toEqual({
      model: "text-embedding",
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requests Ollama batch embeddings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        model: "embeddinggemma",
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      }),
    );
    const client = new EmbeddingClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434/api/",
      fetch: fetchMock,
    });

    await expect(
      client.embed({ model: "embeddinggemma", input: ["first", "second"] }),
    ).resolves.toEqual({
      model: "embeddinggemma",
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "embeddinggemma",
          input: ["first", "second"],
        }),
      }),
    );
  });

  it("maps unavailable embedding providers to recoverable errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new EmbeddingClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      fetch: fetchMock,
    });

    await expect(client.listModels()).rejects.toMatchObject({
      code: "EMBEDDING_UNAVAILABLE",
    } satisfies Partial<IxplorerError>);
  });

  it("maps missing embedding models to recoverable errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "not found" }, { status: 404 }));
    const client = new EmbeddingClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(client.embed({ model: "missing", input: ["chunk"] })).rejects.toMatchObject({
      code: "MODEL_NOT_FOUND",
    } satisfies Partial<IxplorerError>);
  });

  it("rejects malformed embedding responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ embeddings: [[0.1], "bad"] }));
    const client = new EmbeddingClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      fetch: fetchMock,
    });

    await expect(client.embed({ model: "embeddinggemma", input: ["chunk"] })).rejects.toMatchObject(
      {
        code: "EMBEDDING_UNAVAILABLE",
      } satisfies Partial<IxplorerError>,
    );
  });
});
