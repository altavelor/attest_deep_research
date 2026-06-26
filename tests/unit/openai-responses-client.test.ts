import { OpenAiResponsesClient } from "../../src/adapters/model-provider/chat/OpenAiResponsesClient";

function streamResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          const data = event === "[DONE]" ? "[DONE]" : JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const tool = {
  type: "function" as const,
  function: {
    name: "search_index",
    description: "Search",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
};

describe("OpenAiResponsesClient", () => {
  it("maps native Responses payload and parses ordered text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamResponse([
        {
          type: "response.reasoning.delta",
          output_index: 0,
          delta: "Inspect the labels. ",
        },
        {
          type: "response.reasoning_summary_text.delta",
          output_index: 0,
          summary_index: 1,
          delta: "Plan",
        },
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.output_text.delta", delta: "lo" },
        {
          type: "response.completed",
          response: {
            id: "resp-secret",
            status: "completed",
            output: [
              {
                id: "msg-1",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "Hello", annotations: [] }],
              },
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 4,
              output_tokens_details: { reasoning_tokens: 2 },
            },
          },
        },
      ]),
    );
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      fetch: fetchMock,
    });
    const deltas: string[] = [];
    const normalizedEvents: string[] = [];
    const result = await client.runRound({
      model: "gpt-5",
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hi" },
      ],
      maxTokens: 100,
      onDelta: (delta) => deltas.push(`${delta.type}:${delta.text}`),
      onEvent: (event) => normalizedEvents.push(event.type),
    });

    expect(result).toMatchObject({
      items: [{ type: "text", text: "Hello" }],
      stopReason: "complete",
    });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4, reasoningTokens: 2 });
    expect(deltas).toEqual([
      "reasoningSummary:Inspect the labels. ",
      "reasoningSummary:Plan",
      "text:Hel",
      "text:lo",
    ]);
    expect(normalizedEvents).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "reasoning-end",
      "text-delta",
      "text-delta",
      "usage",
      "complete",
    ]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: "gpt-5",
      instructions: "Be concise",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hi" }],
        },
      ],
      max_output_tokens: 100,
      store: false,
      stream: true,
    });
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("include");
  });

  it("accepts the OpenRouter DONE sentinel after a terminal event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamResponse([
        {
          type: "response.completed",
          response: {
            status: "completed",
            output: [
              {
                id: "msg",
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "ok" }],
              },
            ],
          },
        },
        "[DONE]",
      ]),
    );
    const client = new OpenAiResponsesClient({
      baseUrl: "https://openrouter.ai/api/v1",
      fetch: fetchMock,
    });

    await expect(client.runRound({ model: "openai/o4-mini", messages: [] })).resolves.toMatchObject(
      {
        stopReason: "complete",
        items: [{ type: "text", text: "ok" }],
      },
    );
  });

  it("surfaces bounded structured provider errors for failed probes", async () => {
    const client = new OpenAiResponsesClient({
      baseUrl: "https://openrouter.ai/api/v1",
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "invalid_request", message: "Invalid input item" } }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
        ),
    });

    await expect(client.runRound({ model: "openai/o4-mini", messages: [] })).rejects.toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      details: {
        status: 400,
        providerCode: "invalid_request",
        providerMessage: "Invalid input item",
      },
    });
  });

  it("preserves encrypted reasoning and provider call order across stateless continuation", async () => {
    const firstOutput = [
      {
        id: "rs-1",
        type: "reasoning",
        encrypted_content: "encrypted-sentinel",
        summary: ["Checked the synthetic tool requirement"],
      },
      {
        id: "fc-1",
        type: "function_call",
        call_id: "call-1",
        name: "search_index",
        arguments: '{"query":"one"}',
        status: "completed",
      },
      {
        id: "fc-2",
        type: "function_call",
        call_id: "call-2",
        name: "search_index",
        arguments: '{"query":"two"}',
        status: "completed",
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([
          { type: "response.completed", response: { status: "completed", output: firstOutput } },
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          {
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  id: "msg-2",
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: "Done", annotations: [] }],
                },
              ],
            },
          },
        ]),
      );
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      fetch: fetchMock,
      reasoningEfforts: ["high"],
      reasoningSummary: true,
    });
    const first = await client.runRound({
      model: "gpt-5",
      messages: [{ role: "user", content: "Research" }],
      tools: [tool],
      toolChoice: { type: "required" },
      parallelToolCalls: true,
      reasoning: { enabled: true, effort: "high", summary: "auto" },
    });
    const second = await client.runRound({
      model: "gpt-5",
      messages: [{ role: "user", content: "Research" }],
      tools: [tool],
      continuation: first.continuation,
      toolOutputs: [
        { callId: "call-2", output: "second" },
        { callId: "call-1", output: "first" },
      ],
      reasoning: { enabled: true, effort: "high", summary: "auto" },
    });

    expect(first.items.filter((item) => item.type === "toolCall")).toHaveLength(2);
    expect(first.items).toContainEqual({
      type: "reasoningSummary",
      text: "Checked the synthetic tool requirement",
    });
    expect(second.items).toEqual([{ type: "text", text: "Done" }]);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstBody).toMatchObject({
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "high", summary: "auto" },
      tool_choice: "required",
      parallel_tool_calls: true,
    });
    expect(firstBody.tools[0]).toMatchObject({
      type: "function",
      name: "search_index",
      strict: false,
    });
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.input.slice(-2)).toEqual([
      { type: "function_call_output", id: "fco_call-1", call_id: "call-1", output: "first" },
      { type: "function_call_output", id: "fco_call-2", call_id: "call-2", output: "second" },
    ]);
    expect(JSON.stringify(secondBody.input)).toContain("encrypted-sentinel");
    first.continuation?.dispose();
    second.continuation?.dispose();
  });

  it("fails closed for incomplete and truncated streams", async () => {
    const incomplete = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      fetch: vi.fn().mockResolvedValue(
        streamResponse([
          {
            type: "response.incomplete",
            response: {
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              output: [],
            },
          },
        ]),
      ),
    });
    await expect(incomplete.runRound({ model: "gpt-5", messages: [] })).resolves.toMatchObject({
      items: [],
      stopReason: "length",
    });

    const truncated = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      fetch: vi
        .fn()
        .mockResolvedValue(
          streamResponse([{ type: "response.output_text.delta", delta: "partial" }]),
        ),
    });
    await expect(truncated.runRound({ model: "gpt-5", messages: [] })).rejects.toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      details: { reason: "responses-stream-truncated" },
    });
  });

  it("continues reasoning tool rounds when a provider omits encrypted content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([
          {
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                { id: "rs", type: "reasoning", summary: [] },
                {
                  id: "fc",
                  type: "function_call",
                  call_id: "call",
                  name: "search_index",
                  arguments: "{}",
                },
              ],
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          {
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  id: "msg",
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "continued" }],
                },
              ],
            },
          },
        ]),
      );
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      fetch: fetchMock,
      reasoningEfforts: ["high"],
    });
    const first = await client.runRound({
      model: "gpt-5",
      messages: [],
      tools: [tool],
      reasoning: { enabled: true, effort: "high", summary: "off" },
    });
    const second = await client.runRound({
      model: "gpt-5",
      messages: [],
      tools: [tool],
      continuation: first.continuation,
      toolOutputs: [{ callId: "call", output: "ok" }],
      reasoning: { enabled: true, effort: "high", summary: "off" },
    });

    expect(second.items).toEqual([{ type: "text", text: "continued" }]);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).input).toContainEqual({
      id: "rs",
      type: "reasoning",
      summary: [],
    });
  });

  it("redacts Responses request bodies from debug logging", async () => {
    const logger = { logRequest: vi.fn(), logResponse: vi.fn(), logError: vi.fn() };
    const client = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      logger,
      fetch: vi.fn().mockResolvedValue(
        streamResponse([
          {
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  id: "msg",
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "safe" }],
                },
              ],
            },
          },
        ]),
      ),
    });
    await client.runRound({
      model: "gpt-5",
      messages: [{ role: "user", content: "vault-content-sentinel" }],
    });

    expect(logger.logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: "[redacted sensitive provider body]",
      }),
    );
    expect(JSON.stringify(logger.logRequest.mock.calls)).not.toContain("vault-content-sentinel");
  });
});
