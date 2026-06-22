import {
  isResponsesCapabilityCurrent,
  probeResponsesCapabilities,
  responsesProbeCacheKey,
} from "../../src/settings/responsesCapabilityProbe";
import { ServerProfile } from "../../src/settings/settings";

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
