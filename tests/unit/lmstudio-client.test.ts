import { LmStudioClient } from "../../src/lmstudio/LmStudioClient";
import { IxplorerError } from "../../src/shared/errors";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

function streamResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

async function collectStream(client: LmStudioClient): Promise<string[]> {
  const chunks: string[] = [];

  for await (const chunk of client.streamChat({
    model: "local-chat",
    messages: [{ role: "user", content: "Hello" }],
  })) {
    chunks.push(`${chunk.content}:${chunk.isComplete}`);
  }

  return chunks;
}

describe("LmStudioClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists model ids from the OpenAI-compatible models endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: "qwen3" }, { id: "nomic-embed-text" }],
      }),
    );
    const client = new LmStudioClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    await expect(client.listModels()).resolves.toEqual(["qwen3", "nomic-embed-text"]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/models", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("streams chat completion deltas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new LmStudioClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    await expect(collectStream(client)).resolves.toEqual(["Hel:false", "lo:false", ":true"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "local-chat",
          messages: [{ role: "user", content: "Hello" }],
          temperature: undefined,
          stream: true,
        }),
      }),
    );
  });

  it("requests OpenAI-compatible embeddings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        model: "text-embedding",
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      }),
    );
    const client = new LmStudioClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    await expect(
      client.embed({ model: "text-embedding", input: ["first chunk", "second chunk"] }),
    ).resolves.toEqual({
      model: "text-embedding",
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });
  });

  it("maps unavailable provider responses to recoverable errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new LmStudioClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    await expect(client.listModels()).rejects.toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
    } satisfies Partial<IxplorerError>);
  });

  it("maps missing model responses to recoverable errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "not found" }, { status: 404 }));
    const client = new LmStudioClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    const stream = client.streamChat({
      model: "missing",
      messages: [{ role: "user", content: "Hello" }],
    });

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: "MODEL_NOT_FOUND",
    } satisfies Partial<IxplorerError>);
  });

  it("rejects malformed embedding responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: "bad" }] }));
    const client = new LmStudioClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    await expect(client.embed({ model: "text-embedding", input: ["chunk"] })).rejects.toMatchObject(
      {
        code: "EMBEDDING_UNAVAILABLE",
      } satisfies Partial<IxplorerError>,
    );
  });
});
