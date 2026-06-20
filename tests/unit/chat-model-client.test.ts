import { ChatModelClient } from "../../src/client/chat/ChatModelClient";
import { IxplorerError } from "../../src/shared/errors";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

function streamResponse(lines: string[], contentType = "text/event-stream"): Response {
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
    headers: { "content-type": contentType },
    status: 200,
  });
}

async function collectStream(client: ChatModelClient): Promise<string[]> {
  const chunks: string[] = [];

  for await (const chunk of client.streamChat({
    model: "local-chat",
    messages: [{ role: "user", content: "Hello" }],
  })) {
    chunks.push(`${chunk.content}:${chunk.isComplete}`);
  }

  return chunks;
}

describe("ChatModelClient", () => {
  const tool = {
    type: "function" as const,
    function: { name: "synthetic_probe", description: "Probe", parameters: { type: "object", properties: {} } },
  };
  it("lists LM Studio model ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: "qwen3" }, { id: "local-chat" }],
      }),
    );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(client.listModels()).resolves.toEqual(["qwen3", "local-chat"]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/models", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("calls fetch with the global receiver for browser compatibility", async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }

      return Promise.resolve(
        jsonResponse({
          data: [{ id: "qwen3" }],
        }),
      );
    }) as typeof fetch;
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(client.listModels()).resolves.toEqual(["qwen3"]);
  });

  it("lists Ollama model names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        models: [{ name: "gemma3" }, { model: "qwen3:latest" }],
      }),
    );
    const client = new ChatModelClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      fetch: fetchMock,
    });

    await expect(client.listModels()).resolves.toEqual(["gemma3", "qwen3:latest"]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/tags", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("streams LM Studio chat completion deltas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(collectStream(client)).resolves.toEqual(["Hel:false", "lo:false", ":true"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("streams OpenAI-compatible tool calls and sends tool definitions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_note","arguments":"{\\"path\\""}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"Research/Note.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    const chunks = [];
    for await (const chunk of client.streamChat({
      model: "local-chat",
      messages: [{ role: "user", content: "Read note" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_note",
            description: "Read a note",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        content: "",
        isComplete: true,
        toolCalls: [
          {
            id: "call_1",
            name: "read_note",
            arguments: { path: "Research/Note.md" },
          },
        ],
      },
    ]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({ name: "read_note" }),
      }),
    ]);
    expect(body).not.toHaveProperty("tool_choice");
  });

  it.each([
    [{ type: "auto" }, "auto"],
    [{ type: "none" }, "none"],
    [{ type: "required" }, "required"],
    [{ type: "specific", name: "synthetic_probe" }, { type: "function", function: { name: "synthetic_probe" } }],
  ] as const)("maps OpenAI tool choice %o", async (toolChoice, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(["data: [DONE]\n\n"]));
    const client = new ChatModelClient({ provider: "lmStudio", baseUrl: "http://localhost:1234/v1", fetch: fetchMock });
    for await (const _ of client.streamChat({
      model: "m", messages: [{ role: "user", content: "probe" }], tools: [tool], toolChoice,
      parallelToolCalls: true,
    })) { /* consume */ }
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.tool_choice).toEqual(expected);
    expect(body.parallel_tool_calls).toBe(true);
  });

  it("maps Anthropic required and specific choices", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(['data: {"type":"message_stop"}\n\n']));
    const client = new ChatModelClient({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", fetch: fetchMock });
    for await (const _ of client.streamChat({
      model: "m", messages: [{ role: "user", content: "probe" }], tools: [tool],
      toolChoice: { type: "specific", name: "synthetic_probe" },
    })) { /* consume */ }
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.tool_choice).toEqual({ type: "tool", name: "synthetic_probe" });
  });

  it("groups parallel Anthropic tool results into one immediate user message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(['data: {"type":"message_stop"}\n\n']));
    const client = new ChatModelClient({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", fetch: fetchMock });
    for await (const _ of client.streamChat({
      model: "m",
      messages: [
        { role: "assistant", content: "", toolCalls: [
          { id: "a", name: "synthetic_probe", arguments: {} },
          { id: "b", name: "synthetic_probe", arguments: {} },
        ] },
        { role: "tool", content: "one", toolCallId: "a" },
        { role: "tool", content: "two", toolCallId: "b" },
      ],
      tools: [tool],
    })) { /* consume */ }
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[1]).toEqual({ role: "user", content: [
      { type: "tool_result", tool_use_id: "a", content: "one" },
      { type: "tool_result", tool_use_id: "b", content: "two" },
    ] });
  });

  it("rejects unsupported or invalid choices before HTTP", async () => {
    const fetchMock = vi.fn();
    const ollama = new ChatModelClient({ provider: "ollama", baseUrl: "http://localhost:11434", fetch: fetchMock });
    const invalid = new ChatModelClient({ provider: "lmStudio", baseUrl: "http://localhost:1234/v1", fetch: fetchMock });
    await expect(ollama.streamChat({ model: "m", messages: [], tools: [tool], toolChoice: { type: "required" } })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    await expect(invalid.streamChat({ model: "m", messages: [], tools: [tool], toolChoice: { type: "specific", name: "missing" } })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams Ollama chat JSON lines", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse(
          [
            '{"message":{"role":"assistant","content":"Hel"},"done":false}\n',
            '{"message":{"role":"assistant","content":"lo"},"done":false}\n',
            '{"message":{"role":"assistant","content":""},"done":true}\n',
          ],
          "application/x-ndjson",
        ),
      );
    const client = new ChatModelClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434/api",
      fetch: fetchMock,
    });

    await expect(collectStream(client)).resolves.toEqual(["Hel:false", "lo:false", ":true"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "local-chat",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
          options: undefined,
        }),
      }),
    );
  });

  it("maps unavailable chat providers to recoverable errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(client.listModels()).rejects.toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
    } satisfies Partial<IxplorerError>);
  });

  it("maps missing chat models to recoverable errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "not found" }, { status: 404 }));
    const client = new ChatModelClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      fetch: fetchMock,
    });
    const stream = client.streamChat({
      model: "missing",
      messages: [{ role: "user", content: "Hello" }],
    });

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: "MODEL_NOT_FOUND",
    } satisfies Partial<IxplorerError>);
  });
});
