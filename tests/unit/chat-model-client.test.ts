import { ChatModelClient } from "@adapters/model-provider";
import type { ChatRequest } from "@core/agent";
import { AttestError } from "@core/errors";
import { USAGE_GRACE_MS } from "@adapters/model-provider/chat/streaming/openAiChatStream";
import { runPastDeadline } from "../support/timers";

vi.mock("@shared", async (importOriginal) => {
  const { withGlobalTimers } = await import("../support/timers");
  return withGlobalTimers(await importOriginal<typeof import("@shared")>());
});

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

  it("preserves the caller's abort reason when the OpenAI SDK wraps cancellation", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Cancelled by user", "AbortError");
    const fetchMock = vi.fn(async () => {
      controller.abort(reason);
      throw new DOMException("The request was aborted.", "AbortError");
    });
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "https://api.example.test/v1",
      fetch: fetchMock,
    });
    const stream = client.streamChat({
      model: "chat-model",
      messages: [{ role: "user", content: "Hello" }],
      signal: controller.signal,
    });

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBe(reason);
  });

  it("does not report completion when OpenAI streaming ends because the caller aborted", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Cancelled while streaming", "AbortError");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(streamController) {
            controller.abort(reason);
            streamController.error(new DOMException("The request was aborted.", "AbortError"));
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "https://api.example.test/v1",
      fetch: fetchMock,
    });
    const stream = client.streamChat({
      model: "chat-model",
      messages: [{ role: "user", content: "Hello" }],
      signal: controller.signal,
    });

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBe(reason);
  });

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

  it("does not impose a receiver on an injected fetch transport", async () => {
    let receiver: unknown = "not-called";
    const fetchMock = vi.fn(function (this: unknown) {
      receiver = this;

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
    expect(receiver).toBeUndefined();
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

  it("turns reasoning off in the Chat Completions body when the caller disables it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"{\\"intent\\":\\"news\\"}"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    const chunks: string[] = [];
    for await (const chunk of client.streamChat({
      model: "qwen3",
      messages: [{ role: "user", content: "classify" }],
      reasoningEnabled: false,
    })) {
      chunks.push(chunk.content);
    }
    expect(chunks.join("")).toContain('"intent":"news"');

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("keeps the reasoning dialect the provider did not reject", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: "Unrecognized request argument supplied: chat_template_kwargs" } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"news"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    const chunks: string[] = [];
    for await (const chunk of client.streamChat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "classify" }],
      reasoningEnabled: false,
    })) {
      chunks.push(chunk.content);
    }

    expect(chunks.join("")).toContain("news");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retried = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retried.reasoning).toEqual({ enabled: false });
    expect(retried).not.toHaveProperty("chat_template_kwargs");
  });

  it("retries without any reasoning dialect when the refusal names none of them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "unsupported parameter" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"news"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    for await (const chunk of client.streamChat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "classify" }],
      reasoningEnabled: false,
    })) {
      expect(chunk).toBeDefined();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retried = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retried).not.toHaveProperty("reasoning");
    expect(retried).not.toHaveProperty("chat_template_kwargs");
  });

  it("gives up one dialect at a time when the provider rejects both", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: "unknown field: chat_template_kwargs" } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "unknown field: reasoning" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"news"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    for await (const chunk of client.streamChat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "classify" }],
      reasoningEnabled: false,
    })) {
      expect(chunk).toBeDefined();
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[1].reasoning).toEqual({ enabled: false });
    expect(bodies[1]).not.toHaveProperty("chat_template_kwargs");
    expect(bodies[2]).not.toHaveProperty("reasoning");
    expect(bodies[2]).not.toHaveProperty("chat_template_kwargs");
  });

  it("does not retry a refusal that names no optional field", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "bad request" } }, { status: 400 }));
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(async () => {
      for await (const _chunk of client.streamChat({
        model: "gpt-4o",
        messages: [{ role: "user", content: "classify" }],
        reasoningEnabled: false,
      })) {
        void _chunk;
      }
    }).rejects.toBeInstanceOf(AttestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the Chat Completions body free of reasoning fields when the caller states no preference", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse(['data: {"choices":[{"delta":{}}]}\n\n', "data: [DONE]\n\n"]),
      );
    const client = new ChatModelClient({
      provider: "lmStudio",
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await collectStream(client);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("chat_template_kwargs");
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
    }

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
            '{"message":{"role":"assistant","content":"<|tool_call>call:attest.list_notes(path=\\"\\")<tool_call|>"},"done":false}\n',
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
    } satisfies Partial<AttestError>);
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
    } satisfies Partial<AttestError>);
  });
});

describe("ChatModelClient token usage", () => {
  const sse = (chunks: unknown[]) =>
    streamResponse([
      ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
      "data: [DONE]\n\n",
    ]);
  const openAiClient = (fetch: typeof globalThis.fetch) =>
    new ChatModelClient({ provider: "lmStudio", baseUrl: "http://localhost:1234/v1", fetch });
  const readNote = {
    type: "function" as const,
    function: { name: "read_note", description: "Read", parameters: { type: "object" } },
  };
  const toolFinish = {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id: "c1", function: { name: "read_note", arguments: "{}" } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
  const openStream = (chunks: unknown[]) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  async function finalEvents(client: ChatModelClient, extra: Partial<ChatRequest> = {}) {
    const chunks = [];
    for await (const chunk of client.streamChat({
      model: "m",
      messages: [{ role: "user", content: "Hi" }],
      ...extra,
    })) {
      chunks.push(chunk);
    }
    const events = chunks.flatMap((chunk) => chunk.events ?? []);
    return {
      last: chunks.at(-1),
      text: chunks.map((chunk) => chunk.content).join(""),
      usage: events.filter((event) => event.type === "usage"),
      tail: events.slice(-2).map((event) => event.type),
    };
  }

  it("requests usage and reports the choice-less final chunk after a tool call finish", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "c1", function: { name: "read_note", arguments: "{}" } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
        { choices: [{ delta: { content: "late" } }] },
        {
          choices: [],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
            completion_tokens_details: { reasoning_tokens: 12 },
            prompt_tokens_details: { cached_tokens: 100 },
            cost: 0.0004,
          },
        },
      ]),
    );

    const { last, text, usage, tail } = await finalEvents(openAiClient(fetchMock));

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).stream_options).toEqual({
      include_usage: true,
    });
    expect(usage).toEqual([
      { type: "usage", inputTokens: 120, outputTokens: 30, reasoningTokens: 12 },
    ]);
    expect([text, tail]).toEqual(["", ["usage", "complete"]]);
    expect(last).toMatchObject({ isComplete: true, toolCalls: [{ id: "c1", name: "read_note" }] });
    expect(last?.events?.at(-1)).toEqual({ type: "complete", stopReason: "tool_calls" });
  });

  it("keeps the last valid cumulative usage and ignores malformed counts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sse([
        {
          choices: [{ delta: { content: "a" } }],
          usage: { prompt_tokens: 9, completion_tokens: 1 },
        },
        {
          choices: [{ delta: { content: "b" }, finish_reason: "stop" }],
          usage: { prompt_tokens: "9", completion_tokens: 4 },
        },
        { choices: [], usage: { prompt_tokens: -1, completion_tokens: 1e20, total_tokens: "x" } },
      ]),
    );

    const { usage, tail } = await finalEvents(openAiClient(fetchMock));

    expect(usage).toEqual([{ type: "usage", inputTokens: 9, outputTokens: 4, reasoningTokens: 0 }]);
    expect(tail).toEqual(["usage", "complete"]);
  });

  it("reports no usage when the provider sends none", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sse([{ choices: [{ delta: { content: "a" }, finish_reason: "stop" }] }]));

    const { usage, last } = await finalEvents(openAiClient(fetchMock));

    expect(usage).toEqual([]);
    expect(last?.events).toEqual([{ type: "complete", stopReason: "complete" }]);
  });

  it("retries without stream_options when the server rejects it and keeps the reasoning body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Unknown field: stream_options" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
      );

    const { usage } = await finalEvents(openAiClient(fetchMock), { reasoningEnabled: true });

    const retried = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retried).not.toHaveProperty("stream_options");
    expect(retried.reasoning).toEqual({ enabled: true });
    expect(usage).toEqual([]);
  });

  it("asks a server that refused stream_options only once per model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Unknown field: stream_options" } }, { status: 400 }),
      )
      .mockImplementation(async () =>
        sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
      );
    const client = openAiClient(fetchMock);

    for (let round = 0; round < 5; round += 1) await finalEvents(client);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(JSON.parse(String(fetchMock.mock.calls[5][1]?.body))).not.toHaveProperty(
      "stream_options",
    );
  });

  it("reports input-only usage with a zero output", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sse([
          { choices: [{ delta: { content: "a" }, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: "5", completion_tokens: "1e3" } },
        ]),
      );

    const { usage } = await finalEvents(openAiClient(fetchMock));

    expect(usage).toEqual([{ type: "usage", inputTokens: 5, outputTokens: 0, reasoningTokens: 0 }]);
  });

  it("does not parse textual tool calls after a native tool_calls finish", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sse([
        {
          choices: [
            {
              delta: { content: '<tool_call>{"name": "read_note", "arguments": {}}</tool_call>' },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    );

    const { last } = await finalEvents(openAiClient(fetchMock), { tools: [readNote] });

    expect(last).not.toHaveProperty("toolCalls");
  });

  it("completes a tool call round when the stream stays open after the finish", async () => {
    const fetchMock = vi.fn().mockResolvedValue(openStream([toolFinish]));

    const { last } = await runPastDeadline(USAGE_GRACE_MS, () =>
      finalEvents(openAiClient(fetchMock)),
    );

    expect(last).toMatchObject({ isComplete: true, toolCalls: [{ id: "c1" }] });
  });

  it("stops waiting once usage arrives on a stream that stays open", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        openStream([
          toolFinish,
          { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
        ]),
      );

    const { usage, last } = await finalEvents(openAiClient(fetchMock));

    expect(usage).toEqual([{ type: "usage", inputTokens: 3, outputTokens: 2, reasoningTokens: 0 }]);
    expect(last).toMatchObject({ isComplete: true, toolCalls: [{ id: "c1" }] });
  });

  it("throws the abort reason when the caller aborts while usage is awaited", async () => {
    const fetchMock = vi.fn().mockResolvedValue(openStream([toolFinish]));
    const controller = new AbortController();
    const reason = new Error("stopped");

    const consume = async () => {
      for await (const _chunk of openAiClient(fetchMock).streamChat({
        model: "m",
        messages: [{ role: "user", content: "Hi" }],
        signal: controller.signal,
      })) {
        controller.abort(reason);
      }
    };

    const thrown = await runPastDeadline(USAGE_GRACE_MS, () =>
      consume().then(
        () => undefined,
        (error: unknown) => error,
      ),
    );

    expect(thrown).toBe(reason);
  });

  it("reports Ollama prompt and eval counts from the done chunk", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse(
          [
            '{"message":{"role":"assistant","content":"Hi"},"done":false}\n',
            '{"message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":42,"eval_count":7}\n',
          ],
          "application/x-ndjson",
        ),
      );
    const client = new ChatModelClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434/api",
      fetch: fetchMock,
    });

    const { usage, tail } = await finalEvents(client);

    expect(usage).toEqual([
      { type: "usage", inputTokens: 42, outputTokens: 7, reasoningTokens: 0 },
    ]);
    expect(tail).toEqual(["usage", "complete"]);
  });

  it("reports Anthropic input from message_start and the final output from message_delta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      anthropicStream([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: { content: [], usage: { input_tokens: 55, output_tokens: 1 } },
          },
        },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 17 },
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

    const { usage, tail } = await finalEvents(client);

    expect(usage).toEqual([
      { type: "usage", inputTokens: 55, outputTokens: 17, reasoningTokens: 0 },
    ]);
    expect(tail).toEqual(["usage", "complete"]);
  });
});
