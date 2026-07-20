import { ChatModelClient } from "@adapters/model-provider";
import { IxplorerError } from "@core/errors";

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

function anthropicStream(events: Array<{ event: string; data: unknown }>): Response {
  return streamResponse(
    events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
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
    function: {
      name: "synthetic_probe",
      description: "Probe",
      parameters: { type: "object", properties: {} },
    },
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
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/models",
      expect.objectContaining({
        method: "GET",
        signal: expect.any(AbortSignal),
      }),
    );
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

  it("omits Authorization for OpenAI-compatible servers without an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "m" }] }));
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await client.listModels();

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers as HeadersInit);
    expect(headers.has("authorization")).toBe(false);
  });

  it("forwards a configured API key as a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "m" }] }));
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "secret-key",
      fetch: fetchMock,
    });

    await client.listModels();

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer secret-key");
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
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/tags");
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

  it("normalizes structured Chat Completions reasoning separately from answer text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"Plan ","content":""}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning":"carefully","content":"Final"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const observed = vi.fn();
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
      onReasoningObserved: observed,
    });
    const events: unknown[] = [];
    for await (const chunk of client.streamChat({ model: "m", messages: [] })) {
      events.push(...(chunk.events ?? []));
    }

    expect(events).toEqual([
      { type: "reasoning-start", segmentId: "reasoning-0", visibility: "text" },
      { type: "reasoning-delta", segmentId: "reasoning-0", text: "Plan " },
      { type: "reasoning-delta", segmentId: "reasoning-0", text: "carefully" },
      { type: "reasoning-end", segmentId: "reasoning-0" },
      { type: "text-delta", text: "Final" },
      { type: "complete", stopReason: "complete" },
    ]);
    expect(observed).toHaveBeenCalledWith({
      protocol: "chat-completions",
      dialect: "reasoning_content",
    });
  });

  it("normalizes inline reasoning tags split across Chat Completions chunks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"nk>plan</th"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"ink>answer"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });
    const events: unknown[] = [];
    const visible: string[] = [];
    for await (const chunk of client.streamChat({ model: "m", messages: [] })) {
      events.push(...(chunk.events ?? []));
      visible.push(chunk.content);
    }

    expect(events).toEqual([
      { type: "reasoning-start", segmentId: "reasoning-inline-0", visibility: "text" },
      { type: "reasoning-delta", segmentId: "reasoning-inline-0", text: "plan" },
      { type: "reasoning-end", segmentId: "reasoning-inline-0" },
      { type: "text-delta", text: "answer" },
      { type: "complete", stopReason: "complete" },
    ]);
    expect(visible.join("")).toBe("answer");
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

    expect(chunks.at(-1)).toMatchObject({
      content: "",
      isComplete: true,
      toolCalls: [
        {
          id: "call_1",
          name: "read_note",
          arguments: { path: "Research/Note.md" },
        },
      ],
    });
    expect(
      chunks
        .flatMap((chunk) => chunk.events ?? [])
        .filter((event) => event.type === "tool-call-delta"),
    ).toHaveLength(2);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({ name: "read_note" }),
      }),
    ]);
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("recovers OpenAI-compatible tool calls when the stream finishes with finish_reason stop", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_note","arguments":"{}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
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

    expect(chunks.at(-1)).toMatchObject({
      isComplete: true,
      toolCalls: [{ id: "call_1", name: "read_note", arguments: {} }],
    });
  });

  it("recovers OpenAI-compatible tool calls leaked as plain text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"<tool_call>{\\"name\\": \\"read_note\\", \\"arguments\\": {}}</tool_call>"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
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

    expect(chunks.at(-1)).toMatchObject({
      isComplete: true,
      toolCalls: [{ name: "read_note", arguments: {} }],
    });
  });

  it.each([
    [{ type: "auto" }, "auto"],
    [{ type: "none" }, "none"],
    [{ type: "required" }, "required"],
    [
      { type: "specific", name: "synthetic_probe" },
      { type: "function", function: { name: "synthetic_probe" } },
    ],
  ] as const)("maps OpenAI tool choice %o", async (toolChoice, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(["data: [DONE]\n\n"]));
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });
    for await (const _ of client.streamChat({
      model: "m",
      messages: [{ role: "user", content: "probe" }],
      tools: [tool],
      toolChoice,
      parallelToolCalls: true,
    })) {
      /* consume */
    }
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.tool_choice).toEqual(expected);
    expect(body.parallel_tool_calls).toBe(true);
  });

  it("posts Anthropic chat to the SDK /v1/messages endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        anthropicStream([{ event: "message_stop", data: { type: "message_stop" } }]),
      );
    const client = new ChatModelClient({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
      fetch: fetchMock,
    });
    for await (const _ of client.streamChat({
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "hi" }],
    })) {
      /* consume */
    }
    // The configured trailing /v1 is stripped; the SDK appends its own.
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
  });

  it("enables adaptive thinking and streams Anthropic reasoning then tool calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      anthropicStream([
        { event: "message_start", data: { type: "message_start", message: { content: [] } } },
        {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking", thinking: "" },
          },
        },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: "Plan" },
          },
        },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "toolu_1", name: "synthetic_probe", input: {} },
          },
        },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: '{"q":1}' },
          },
        },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 1 },
          },
        },
        { event: "message_stop", data: { type: "message_stop" } },
      ]),
    );
    const client = new ChatModelClient({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
      fetch: fetchMock,
    });
    const chunks = [];
    for await (const chunk of client.streamChat({
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "probe" }],
      tools: [tool],
      reasoningEnabled: true,
    })) {
      chunks.push(chunk);
    }

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body).not.toHaveProperty("temperature");

    const events = chunks.flatMap((chunk) => chunk.events ?? []);
    expect(events).toContainEqual({
      type: "reasoning-start",
      segmentId: "reasoning-0",
      visibility: "text",
    });
    expect(events).toContainEqual({
      type: "reasoning-delta",
      segmentId: "reasoning-0",
      text: "Plan",
    });
    expect(events).toContainEqual({ type: "reasoning-end", segmentId: "reasoning-0" });
    expect(chunks.at(-1)).toMatchObject({
      isComplete: true,
      toolCalls: [{ id: "toolu_1", name: "synthetic_probe", arguments: { q: 1 } }],
    });
    expect(events.at(-1)).toEqual({ type: "complete", stopReason: "tool_calls" });
  });

  it("maps Anthropic required and specific choices", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        anthropicStream([{ event: "message_stop", data: { type: "message_stop" } }]),
      );
    const client = new ChatModelClient({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
      fetch: fetchMock,
    });
    for await (const _ of client.streamChat({
      model: "m",
      messages: [{ role: "user", content: "probe" }],
      tools: [tool],
      toolChoice: { type: "specific", name: "synthetic_probe" },
    })) {
      /* consume */
    }
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.tool_choice).toEqual({ type: "tool", name: "synthetic_probe" });
  });

  it("groups parallel Anthropic tool results into one immediate user message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        anthropicStream([{ event: "message_stop", data: { type: "message_stop" } }]),
      );
    const client = new ChatModelClient({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      fetch: fetchMock,
    });
    for await (const _ of client.streamChat({
      model: "m",
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "a", name: "synthetic_probe", arguments: {} },
            { id: "b", name: "synthetic_probe", arguments: {} },
          ],
        },
        { role: "tool", content: "one", toolCallId: "a" },
        { role: "tool", content: "two", toolCallId: "b" },
      ],
      tools: [tool],
    })) {
      /* consume */
    }
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[1]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "one" },
        { type: "tool_result", tool_use_id: "b", content: "two" },
      ],
    });
  });

  it("rejects unsupported or invalid choices before HTTP", async () => {
    const fetchMock = vi.fn();
    const ollama = new ChatModelClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      fetch: fetchMock,
    });
    const invalid = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });
    await expect(
      ollama
        .streamChat({ model: "m", messages: [], tools: [tool], toolChoice: { type: "required" } })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    await expect(
      invalid
        .streamChat({
          model: "m",
          messages: [],
          tools: [tool],
          toolChoice: { type: "specific", name: "missing" },
        })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
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
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/chat");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "local-chat",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    });
  });

  it("requests Ollama thinking when reasoning is enabled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse(
          [
            '{"message":{"role":"assistant","thinking":"Plan","content":""},"done":false}\n',
            '{"message":{"role":"assistant","content":"Answer"},"done":true}\n',
          ],
          "application/x-ndjson",
        ),
      );
    const client = new ChatModelClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434/api",
      fetch: fetchMock,
    });
    const events: unknown[] = [];
    for await (const chunk of client.streamChat({
      model: "gpt-oss",
      messages: [{ role: "user", content: "think" }],
      reasoningEnabled: true,
    })) {
      events.push(...(chunk.events ?? []));
    }
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.think).toBe(true);
    expect(events).toContainEqual({
      type: "reasoning-delta",
      segmentId: "reasoning-0",
      text: "Plan",
    });
    expect(events).toContainEqual({ type: "text-delta", text: "Answer" });
  });

  it("recovers a tool call leaked as text in the Ollama content stream", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse(
          [
            '{"message":{"role":"assistant","content":"<|tool_call>call:ixplorer.list_notes(path=\\"\\")<tool_call|>"},"done":false}\n',
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

    const toolCalls: unknown[] = [];
    for await (const chunk of client.streamChat({
      model: "gemma",
      messages: [{ role: "user", content: "show list of notes" }],
      tools: [
        {
          type: "function",
          function: {
            name: "list_notes",
            description: "List notes",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    })) {
      if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
    }

    expect(toolCalls).toEqual([{ id: "text_call_0", name: "list_notes", arguments: { path: "" } }]);
  });

  it("does not synthesize tool calls from native Ollama tool_calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse(
          [
            '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"list_notes","arguments":{"prefix":"Daily"}}}]},"done":false}\n',
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

    const toolCalls: Array<{ name: string }> = [];
    for await (const chunk of client.streamChat({
      model: "gemma",
      messages: [{ role: "user", content: "list daily notes" }],
      tools: [
        {
          type: "function",
          function: {
            name: "list_notes",
            description: "List notes",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    })) {
      if (chunk.toolCalls) toolCalls.push(...(chunk.toolCalls as Array<{ name: string }>));
    }

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("list_notes");
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
