import { AttestError } from "@core/errors";
import { OpenAiResponsesClient } from "@adapters/model-provider";
import { parseResponsesTerminalEvent } from "@adapters/model-provider/chat/responses/OpenAiResponsesStreamParser";

function completed(output: unknown[], usage?: unknown): unknown {
  return {
    type: "response.completed",
    response: { status: "completed", output, ...(usage ? { usage } : {}) },
  };
}

function expectProtocolError(value: unknown, reason: string): void {
  expect(() => parseResponsesTerminalEvent(value)).toThrow(AttestError);
  try {
    parseResponsesTerminalEvent(value);
  } catch (error) {
    expect(error).toMatchObject({ code: "MODEL_PROVIDER_UNAVAILABLE", details: { reason } });
  }
}

function sseResponse(events: unknown[]): Response {
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

describe("parseResponsesTerminalEvent ignores non-terminal input", () => {
  it("returns undefined for values that are not typed events", () => {
    expect(parseResponsesTerminalEvent(undefined)).toBeUndefined();
    expect(parseResponsesTerminalEvent(null)).toBeUndefined();
    expect(parseResponsesTerminalEvent("response.completed")).toBeUndefined();
    expect(parseResponsesTerminalEvent([{ type: "response.completed" }])).toBeUndefined();
    expect(parseResponsesTerminalEvent({ response: {} })).toBeUndefined();
    expect(parseResponsesTerminalEvent({ type: "response.output_text.delta" })).toBeUndefined();
  });
});

describe("parseResponsesTerminalEvent surfaces typed protocol errors", () => {
  it("rejects an explicit provider error event", () => {
    expectProtocolError({ type: "error", message: "boom" }, "responses-provider-error");
  });

  it("rejects a terminal event without a response object", () => {
    expectProtocolError({ type: "response.completed" }, "responses-terminal-missing-response");
    expectProtocolError(
      { type: "response.completed", response: [] },
      "responses-terminal-missing-response",
    );
  });

  it("rejects failed and unknown terminal statuses", () => {
    expectProtocolError({ type: "response.failed", response: { output: [] } }, "responses-failed");
    expectProtocolError(
      { type: "response.completed", response: { status: "failed", output: [] } },
      "responses-failed",
    );
    expectProtocolError(
      { type: "response.completed", response: { status: "in_progress", output: [] } },
      "responses-unknown-terminal-status",
    );
  });

  it("rejects output items that are not records or carry no id", () => {
    expectProtocolError(
      { type: "response.completed", response: { status: "completed", output: ["text"] } },
      "responses-invalid-output-item",
    );
    expectProtocolError(
      completed([{ type: "message", content: [] }]),
      "responses-output-item-missing-id",
    );
    expectProtocolError(
      completed([{ id: "", type: "message", content: [] }]),
      "responses-output-item-missing-id",
    );
  });

  it("rejects malformed message content", () => {
    expectProtocolError(
      completed([{ id: "m1", type: "message", content: "Hello" }]),
      "responses-invalid-message-content",
    );
    expectProtocolError(
      completed([{ id: "m1", type: "message", content: ["Hello"] }]),
      "responses-invalid-content-part",
    );
  });

  it("rejects malformed function calls and their arguments", () => {
    expectProtocolError(
      completed([{ id: "f1", type: "function_call", name: "search", arguments: "{}" }]),
      "responses-invalid-function-call",
    );
    expectProtocolError(
      completed([{ id: "f1", type: "function_call", call_id: "c1", arguments: "{}" }]),
      "responses-invalid-function-call",
    );
    expectProtocolError(
      completed([{ id: "f1", type: "function_call", call_id: "c1", name: "search" }]),
      "responses-invalid-function-call",
    );
    expectProtocolError(
      completed([
        { id: "f1", type: "function_call", call_id: "c1", name: "search", arguments: "{oops" },
      ]),
      "responses-invalid-function-arguments",
    );
    expectProtocolError(
      completed([
        { id: "f1", type: "function_call", call_id: "c1", name: "search", arguments: "[1,2]" },
      ]),
      "responses-invalid-function-arguments",
    );
  });
});

describe("parseResponsesTerminalEvent tolerates partial payloads", () => {
  it("keeps only usable text parts of a message", () => {
    const parsed = parseResponsesTerminalEvent(
      completed([
        {
          id: "m1",
          type: "message",
          content: [
            { type: "output_text", text: "" },
            { type: "refusal", text: "no" },
            { type: "output_text", text: 42 },
            { type: "output_text", text: "Hello" },
          ],
        },
      ]),
    );

    expect(parsed!.result.items).toEqual([{ type: "text", text: "Hello" }]);
    expect(parsed!.result.stopReason).toBe("complete");
  });

  it("keeps only usable reasoning summaries and reasoning text", () => {
    const parsed = parseResponsesTerminalEvent(
      completed([
        {
          id: "r1",
          type: "reasoning",
          summary: ["Plan", "", 7, { type: "summary_text", text: "More" }, { type: "other" }, null],
          content: [{ type: "reasoning_text", text: "Deep" }, { type: "reasoning_text" }, "raw"],
        },
        { id: "r2", type: "reasoning", summary: "not-an-array", content: "not-an-array" },
        { id: "u1", type: "unknown_item" },
      ]),
    );

    expect(parsed!.result.items).toEqual([
      { type: "reasoningSummary", text: "Plan" },
      { type: "reasoningSummary", text: "More" },
      { type: "reasoningSummary", text: "Deep" },
    ]);
    expect(parsed!.result.reasoningItemCount).toBe(2);
  });

  it("treats an incomplete response as a length stop without items", () => {
    expect(parseResponsesTerminalEvent({ type: "response.incomplete", response: {} })).toEqual({
      result: { items: [], stopReason: "length", usage: undefined },
      providerOutput: [],
    });
    expect(
      parseResponsesTerminalEvent({
        type: "response.completed",
        response: { status: "incomplete" },
      })!.result.stopReason,
    ).toBe("length");
  });

  it("defaults missing or invalid usage counters instead of failing", () => {
    expect(parseResponsesTerminalEvent(completed([]))!.result.usage).toBeUndefined();
    expect(
      parseResponsesTerminalEvent(
        completed([], { input_tokens: -3, output_tokens: "many", output_tokens_details: null }),
      )!.result.usage,
    ).toEqual({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
  });

  it("reports a tool-call stop when a valid function call is present", () => {
    const parsed = parseResponsesTerminalEvent(
      completed([
        {
          id: "f1",
          type: "function_call",
          call_id: "c1",
          name: "search_index",
          arguments: '{"query":"x"}',
        },
      ]),
    );

    expect(parsed!.result.stopReason).toBe("tool_calls");
    expect(parsed!.result.items).toEqual([
      { type: "toolCall", call: { id: "c1", name: "search_index", arguments: { query: "x" } } },
    ]);
    expect(parsed!.providerOutput).toHaveLength(1);
  });
});

describe("Responses stream failures release the round with a typed error", () => {
  function client(response: Response | Promise<Response>, signal?: AbortSignal) {
    const instance = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      fetch: vi.fn().mockResolvedValue(response),
    });
    return instance.runRound({
      model: "gpt-5",
      messages: [],
      ...(signal ? { signal } : {}),
    });
  }

  it("rejects a malformed SSE payload with a typed error", async () => {
    const encoder = new TextEncoder();
    const body = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("data: {not json\n\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

    await expect(client(body)).rejects.toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      details: { reason: "responses-invalid-sse-json" },
    });
  });

  it("rejects a stream that ends mid-message before any terminal event", async () => {
    await expect(
      client(sseResponse([{ type: "response.output_text.delta", delta: "half" }])),
    ).rejects.toMatchObject({ details: { reason: "responses-stream-truncated" } });
  });

  it("rejects a DONE sentinel that arrives before the terminal event", async () => {
    await expect(client(sseResponse(["[DONE]"]))).rejects.toMatchObject({
      details: { reason: "responses-done-before-terminal" },
    });
  });

  it("rejects extra data after the terminal event", async () => {
    await expect(
      client(sseResponse([completed([]), { type: "response.output_text.delta", delta: "late" }])),
    ).rejects.toMatchObject({ details: { reason: "responses-data-after-terminal" } });
  });

  it("rejects a stream whose text deltas disagree with the terminal message", async () => {
    await expect(
      client(
        sseResponse([
          { type: "response.output_text.delta", delta: "Hel" },
          completed([
            {
              id: "m1",
              type: "message",
              content: [{ type: "output_text", text: "Goodbye" }],
            },
          ]),
        ]),
      ),
    ).rejects.toMatchObject({ details: { reason: "responses-stream-text-mismatch" } });
  });

  it("rejects a response that carries no stream body", async () => {
    await expect(
      client(new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } })),
    ).rejects.toMatchObject({ details: { reason: "responses-empty-stream" } });
  });

  it("propagates cancellation instead of returning a partial round", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const deltas: string[] = [];
    const body = new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(
            encoder.encode('data: {"type":"response.output_text.delta","delta":"half"}\n\n'),
          );
          controller.abort();
          streamController.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

    const instance = new OpenAiResponsesClient({
      baseUrl: "https://api.openai.com/v1",
      fetch: vi.fn().mockResolvedValue(body),
    });

    await expect(
      instance.runRound({
        model: "gpt-5",
        messages: [],
        signal: controller.signal,
        onDelta: (delta) => deltas.push(delta.text),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(deltas.join("")).not.toContain("Goodbye");
  });
});
