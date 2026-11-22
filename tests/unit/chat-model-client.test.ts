import { ChatModelClient } from "@adapters/model-provider";
import { AttestError } from "@core/errors";
import { chunkedStream } from "../support/streams";
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

  it("preserves the caller's abort reason when the request is cancelled", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Cancelled by user", "AbortError");
    const fetchMock = vi.fn(async () => {
      controller.abort(reason);
      throw new DOMException("The request was aborted.", "AbortError");
    });
    const client = new ChatModelClient({
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
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });

    await expect(client.listModels()).resolves.toEqual(["qwen3"]);
    expect(receiver).toBeUndefined();
  });

  it("omits Authorization for OpenAI-compatible servers without an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: "m" }] }));
    const client = new ChatModelClient({
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
      baseUrl: "http://localhost:1234/v1",
      apiKey: "secret-key",
      fetch: fetchMock,
    });

    await client.listModels();

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer secret-key");
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

  it("reports the original failure when the retry without reasoning fields also fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "bad request" } }, { status: 400 }));
    const client = new ChatModelClient({
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves the Chat Completions body free of reasoning fields when the caller states no preference", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse(['data: {"choices":[{"delta":{}}]}\n\n', "data: [DONE]\n\n"]),
      );
    const client = new ChatModelClient({
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

  it("reads past a frame without usage to the usage trailer after a tool_calls finish", async () => {
    const onCancel = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          chunkedStream(
            [
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_note","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
              'data: {"choices":[{"delta":{"content":"late"}}]}\n\n',
              'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":60}}}\n\n',
            ],
            onCancel,
          ),
          { headers: { "content-type": "text/event-stream" } },
        ),
      );
    const client = new ChatModelClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    const events = [];
    for await (const chunk of client.streamChat({
      model: "local-chat",
      messages: [{ role: "user", content: "Read note" }],
    })) {
      events.push(...(chunk.events ?? []));
    }

    expect(events.map((event) => event.type)).toEqual(["tool-call-delta", "usage", "complete"]);
    expect(events[1]).toEqual({
      type: "usage",
      inputTokens: 100,
      outputTokens: 5,
      reasoningTokens: 0,
      cachedInputTokens: 60,
    });
    expect(events[2]).toEqual({ type: "complete", stopReason: "tool_calls" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("completes at once when the tool_calls finish frame already carries usage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          chunkedStream(
            [
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_note","arguments":"{}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":7,"completion_tokens":1}}\n\n',
            ],
            vi.fn(),
          ),
          { headers: { "content-type": "text/event-stream" } },
        ),
      );
    const client = new ChatModelClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    const events = [];
    for await (const chunk of client.streamChat({
      model: "local-chat",
      messages: [{ role: "user", content: "Read note" }],
    })) {
      events.push(...(chunk.events ?? []));
    }

    expect(events.map((event) => event.type)).toEqual(["tool-call-delta", "usage", "complete"]);
  });

  it("gives up on a missing usage trailer and cancels the open stream", async () => {
    const onCancel = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          chunkedStream(
            [
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_note","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
            ],
            onCancel,
          ),
          { headers: { "content-type": "text/event-stream" } },
        ),
      );
    const client = new ChatModelClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    const chunks = await runPastDeadline(2_000, async () => {
      const received = [];
      for await (const chunk of client.streamChat({
        model: "local-chat",
        messages: [{ role: "user", content: "Read note" }],
      })) {
        received.push(chunk);
      }
      return received;
    });

    expect(chunks.flatMap((chunk) => chunk.events ?? []).map((event) => event.type)).toEqual([
      "tool-call-delta",
      "complete",
    ]);
    expect(chunks.at(-1)?.toolCalls).toHaveLength(1);
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ name: "TimeoutError" }));
  });

  it("completes a tool_calls finish at once when the retry dropped stream_options", async () => {
    const onCancel = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "unknown field: stream_options" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response(
          chunkedStream(
            [
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_note","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
            ],
            onCancel,
          ),
          {
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );
    const client = new ChatModelClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    const events = [];
    for await (const chunk of client.streamChat({
      model: "local-chat",
      messages: [{ role: "user", content: "Read note" }],
    })) {
      events.push(...(chunk.events ?? []));
    }

    expect(events.map((event) => event.type)).toEqual(["tool-call-delta", "complete"]);
    expect(onCancel).toHaveBeenCalled();
  });

  it("asks for stream usage and drops only that field when the provider rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "unknown field: stream_options" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );
    const client = new ChatModelClient({ baseUrl: "http://localhost:1234/v1", fetch: fetchMock });

    for await (const chunk of client.streamChat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "classify" }],
      reasoningEnabled: false,
    })) {
      expect(chunk).toBeDefined();
    }

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0].stream_options).toEqual({ include_usage: true });
    expect(bodies[1]).not.toHaveProperty("stream_options");
    expect(bodies[1].reasoning).toEqual({ enabled: false });
    expect(bodies[1].chat_template_kwargs).toEqual({ enable_thinking: false });
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

  it.each([
    ["https://api.anthropic.com/v1", undefined, 4096],
    ["https://EU.API.Anthropic.com/v1", 512, 512],
  ] as const)(
    "applies the Anthropic host rules to Chat Completions on %s with maxTokens %o",
    async (baseUrl, maxTokens, expected) => {
      const fetchMock = vi.fn().mockResolvedValue(streamResponse(["data: [DONE]\n\n"]));
      const client = new ChatModelClient({
        baseUrl,
        fetch: fetchMock,
      });
      for await (const _ of client.streamChat({
        model: "claude",
        messages: [{ role: "user", content: "hi" }],
        maxTokens,
        reasoningEnabled: true,
      })) {
      }
      const init = fetchMock.mock.calls[0][1];
      const body = JSON.parse(String(init?.body));
      expect(body.max_tokens).toBe(expected);
      expect(body).not.toHaveProperty("reasoning");
      expect(body).not.toHaveProperty("chat_template_kwargs");
      expect(init?.headers).toMatchObject({ "anthropic-version": "2023-06-01" });
    },
  );

  it.each([{ type: "required" }, { type: "specific", name: "synthetic_probe" }] as const)(
    "downgrades the forced tool choice %o to auto on the Anthropic host",
    async (toolChoice) => {
      const fetchMock = vi.fn().mockResolvedValue(streamResponse(["data: [DONE]\n\n"]));
      const client = new ChatModelClient({
        baseUrl: "https://api.anthropic.com/v1",
        fetch: fetchMock,
      });
      for await (const _ of client.streamChat({
        model: "claude",
        messages: [{ role: "user", content: "probe" }],
        tools: [tool],
        toolChoice,
      })) {
      }
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).tool_choice).toBe("auto");
    },
  );

  it("rejects unsupported or invalid choices before HTTP", async () => {
    const fetchMock = vi.fn();
    const invalid = new ChatModelClient({
      baseUrl: "http://localhost:1234/v1",
      fetch: fetchMock,
    });
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
    const anthropicHost = new ChatModelClient({
      baseUrl: "https://api.anthropic.com/v1",
      fetch: fetchMock,
    });
    await expect(
      anthropicHost
        .streamChat({
          model: "m",
          messages: [],
          tools: [tool],
          toolChoice: { type: "specific", name: "missing" },
        })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
      message: "Specific tool is not defined: missing.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps unavailable chat providers to recoverable errors", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new ChatModelClient({
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
      baseUrl: "http://localhost:1234/v1",
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
