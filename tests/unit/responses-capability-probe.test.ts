import {
  isResponsesCapabilityCurrent,
  probeResponsesCapabilities,
  responsesProbeCacheKey,
} from "@adapters/settings";
import { ServerProfile } from "@adapters/settings";

function streamResponse(output: unknown[]): Response {
  const body = JSON.stringify({
    type: "response.completed",
    response: { status: "completed", output },
  });
  return new Response(`data: ${body}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function probeServer(): ServerProfile {
  return {
    id: "openai",
    name: "OpenAI",
    apiFormat: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "secret",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
  };
}

function toolCallRound(id: string): Response {
  return streamResponse([
    { id: `reasoning-${id}`, type: "reasoning", encrypted_content: "encrypted", summary: [] },
    {
      id: `function-${id}`,
      type: "function_call",
      call_id: `call-${id}`,
      name: "ixplorer_responses_probe",
      arguments: "{}",
    },
  ]);
}

function completionRound(id: string): Response {
  return streamResponse([
    {
      id: `message-${id}`,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "ok" }],
    },
  ]);
}

function abortingFetch(options: {
  responses: (() => Response)[];
  abortAfterCall?: number;
  controller: AbortController;
}) {
  const state = { networkCalls: 0 };
  const fetchMock = vi.fn(async (_input: unknown, init?: { signal?: AbortSignal | null }) => {
    if (init?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    state.networkCalls += 1;
    const factory = options.responses[state.networkCalls - 1] ?? options.responses.at(-1)!;
    const response = factory();
    if (state.networkCalls === options.abortAfterCall) options.controller.abort();
    return response;
  });
  return { fetchMock, state };
}

describe("Responses capability probe cancellation", () => {
  it("raises AbortError without issuing a network call when cancelled before the first attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchMock, state } = abortingFetch({
      responses: [() => toolCallRound("1"), () => completionRound("1")],
      controller,
    });

    await expect(
      probeResponsesCapabilities({
        server: probeServer(),
        model: "gpt-5",
        efforts: ["medium"],
        fetch: fetchMock as unknown as typeof fetch,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(state.networkCalls).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops issuing requests when cancelled between two effort attempts", async () => {
    const controller = new AbortController();
    const { fetchMock, state } = abortingFetch({
      responses: [
        () => toolCallRound("1"),
        () => completionRound("1"),
        () => toolCallRound("2"),
        () => completionRound("2"),
      ],
      abortAfterCall: 2,
      controller,
    });

    await expect(
      probeResponsesCapabilities({
        server: probeServer(),
        model: "gpt-5",
        efforts: ["medium", "low"],
        fetch: fetchMock as unknown as typeof fetch,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(state.networkCalls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops issuing requests when cancelled after the final summary attempt", async () => {
    const controller = new AbortController();
    const { fetchMock, state } = abortingFetch({
      responses: [
        () => toolCallRound("1"),
        () => completionRound("1"),
        () => toolCallRound("2"),
        () => completionRound("2"),
      ],
      abortAfterCall: 4,
      controller,
    });

    await expect(
      probeResponsesCapabilities({
        server: probeServer(),
        model: "gpt-5",
        efforts: ["medium"],
        fetch: fetchMock as unknown as typeof fetch,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(state.networkCalls).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("preserves the failure reason of the attempt that ran before the cancellation", async () => {
    const controller = new AbortController();
    const { fetchMock, state } = abortingFetch({
      responses: [() => completionRound("1"), () => completionRound("2")],
      abortAfterCall: 1,
      controller,
    });

    const error = await probeResponsesCapabilities({
      server: probeServer(),
      model: "gpt-5",
      efforts: ["medium", "low"],
      fetch: fetchMock as unknown as typeof fetch,
      signal: controller.signal,
    }).then(
      () => undefined,
      (thrown: unknown) => thrown as DOMException & { failureReason?: string },
    );

    expect(error?.name).toBe("AbortError");
    expect(error?.failureReason).toBe("Responses probe did not receive the required tool call.");
    expect(state.networkCalls).toBe(1);
  });

  it("keeps the earliest failure reason when a later attempt reports none", async () => {
    const responses = [
      () => completionRound("1"),
      () => {
        throw new Error("socket hang up");
      },
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      const factory = responses[Math.min(call, responses.length) - 1];
      return factory();
    });

    const result = await probeResponsesCapabilities({
      server: probeServer(),
      model: "gpt-5",
      efforts: ["medium", "low"],
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(result.responses).toBe(false);
    expect(result.failureReason).toBe("Responses probe did not receive the required tool call.");
  });
});

describe("Responses capability probe", () => {
  it("reuses a successful probe only while its provider identity and contract are current", () => {
    const server = { baseUrl: "https://api.openai.com/v1", apiKey: "secret" };
    const checkedAt = "2026-06-20T00:00:00.000Z";
    const capabilities = {
      source: "probe" as const,
      responses: true,
      continuation: true,
      summary: false,
      efforts: ["medium"],
      checkedAt,
      contractVersion: 1,
      cacheKey: responsesProbeCacheKey(server, "gpt-5", ["medium"]),
    };

    expect(
      isResponsesCapabilityCurrent(
        capabilities,
        server,
        "gpt-5",
        Date.parse("2026-06-21T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isResponsesCapabilityCurrent(
        capabilities,
        server,
        "gpt-5-mini",
        Date.parse("2026-06-21T00:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isResponsesCapabilityCurrent(
        capabilities,
        server,
        "gpt-5",
        Date.parse("2026-06-28T00:00:00.001Z"),
      ),
    ).toBe(false);
  });

  it("invalidates its cache identity when endpoint, auth, model, or effort changes", async () => {
    const server = { baseUrl: "https://api.openai.com/v1/", apiKey: "secret-a" };
    const base = responsesProbeCacheKey(server, "gpt-5", ["high"]);

    expect(
      responsesProbeCacheKey({ ...server, baseUrl: "https://proxy.example/v1" }, "gpt-5", ["high"]),
    ).not.toBe(base);
    expect(responsesProbeCacheKey({ ...server, apiKey: "secret-b" }, "gpt-5", ["high"])).not.toBe(
      base,
    );
    expect(responsesProbeCacheKey(server, "gpt-5-mini", ["high"])).not.toBe(base);
    expect(responsesProbeCacheKey(server, "gpt-5", ["low"])).not.toBe(base);
    expect(base).not.toContain("secret-a");
  });

  it("starts with a standard explicit effort for models where reasoning is mandatory", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([
          { id: "reasoning-1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
          {
            id: "function-1",
            type: "function_call",
            call_id: "call-1",
            name: "ixplorer_responses_probe",
            arguments: "{}",
          },
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          {
            id: "message-1",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "ok" }],
          },
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          {
            id: "reasoning-2",
            type: "reasoning",
            encrypted_content: "encrypted-summary",
            summary: ["Synthetic summary"],
          },
          {
            id: "function-2",
            type: "function_call",
            call_id: "call-2",
            name: "ixplorer_responses_probe",
            arguments: "{}",
          },
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          {
            id: "message-2",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "ok" }],
          },
        ]),
      );
    const server: ServerProfile = {
      id: "openrouter",
      name: "OpenRouter",
      apiFormat: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "secret",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    };

    const result = await probeResponsesCapabilities({
      server,
      model: "openai/gpt-oss-120b:free",
      fetch: fetchMock,
    });

    expect(result).toMatchObject({
      responses: true,
      continuation: true,
      summary: true,
      efforts: ["medium"],
      defaultEffort: "medium",
    });
    const initialBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(initialBody.reasoning).toEqual({ effort: "medium" });
    expect(initialBody.max_output_tokens).toBeGreaterThanOrEqual(512);
    const continuationBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(continuationBody.input.at(-1)).toMatchObject({
      type: "function_call_output",
      id: "fco_call-1",
      call_id: "call-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
