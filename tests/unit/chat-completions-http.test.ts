import { describe, expect, it } from "vitest";

import { ProviderHttpClient } from "@adapters/model-provider/common/http";
import {
  listOpenAiCompatibleModelIds,
  openChatCompletionsStream,
} from "@adapters/model-provider/chat/streaming/chatCompletionsHttp";
import { AttestError } from "@core/errors";
import { chunkedStream } from "../support/streams";

function clientFor(response: () => Response, apiKey?: string): ProviderHttpClient {
  return new ProviderHttpClient({
    apiFormat: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKey,
    fetch: () => Promise.resolve(response()),
    unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
    unavailableMessage: "The chat model provider is unavailable.",
  });
}

async function collect(http: ProviderHttpClient): Promise<Array<Record<string, unknown>>> {
  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of await openChatCompletionsStream(http, { model: "m" })) {
    chunks.push(chunk);
  }
  return chunks;
}

async function failure(promise: Promise<unknown>): Promise<AttestError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AttestError)) throw new Error("expected an AttestError");
  return error;
}

describe("openChatCompletionsStream", () => {
  it("stops at [DONE] and closes the live connection", async () => {
    const cancelled: unknown[] = [];
    const body = chunkedStream(
      [
        'data: {"id":"a"}\n\n',
        'data: {"error":null,"id":"b"}\n\n',
        "data: [DONE]\n\n",
        'data: {"id":"late"}\n\n',
      ],
      (reason) => cancelled.push(reason),
    );

    const chunks = await collect(clientFor(() => new Response(body)));

    expect(chunks).toEqual([{ id: "a" }, { error: null, id: "b" }]);
    expect(cancelled).toHaveLength(1);
  });

  it("rejects a frame that is not a JSON object", async () => {
    for (const frame of ["data: {oops\n\n", "data: null\n\n", "data: 1\n\n"]) {
      const http = clientFor(() => new Response(chunkedStream([frame])));

      const error = await failure(collect(http));

      expect(error.code).toBe("MODEL_PROVIDER_UNAVAILABLE");
      expect(error.details).toMatchObject({ reason: "chat-completions-invalid-sse-json" });
    }
  });

  it("wraps a body read failure that is not an abort", async () => {
    const streamError = new Error("socket reset");
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.error(streamError);
        else controller.enqueue(new TextEncoder().encode('data: {"id":"a"}\n\n'));
        sent = true;
      },
    });

    const error = await failure(collect(clientFor(() => new Response(body))));

    expect(error.code).toBe("MODEL_PROVIDER_UNAVAILABLE");
    expect(error.message).toBe("The model provider stream failed.");
    expect(error.cause).toBe(streamError);
  });

  it("rejects with the caller's abort reason once the request is cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped by user");
    const body = chunkedStream(['data: {"id":"a"}\n\n'], () => undefined);
    const http = clientFor(() => new Response(body));
    const stream = await openChatCompletionsStream(http, { model: "m" }, controller.signal);

    const outcome = (async () => {
      for await (const chunk of stream) {
        expect(chunk).toEqual({ id: "a" });
        controller.abort(reason);
      }
    })();

    await expect(outcome).rejects.toBe(reason);
  });

  it("reports a mid-stream provider error without the API key", async () => {
    const frame = 'data: {"error":{"message":"bad key sk-test rejected"}}\n\n';
    const http = clientFor(() => new Response(chunkedStream([frame])), "sk-test");

    const error = await failure(collect(http));

    expect(error.code).toBe("MODEL_PROVIDER_UNAVAILABLE");
    expect(error.message).toBe("Provider returned an error mid-stream.");
    expect(error.details).toEqual({ providerMessage: "bad key [redacted] rejected" });
  });

  it("rejects a response without a body", async () => {
    const error = await failure(collect(clientFor(() => new Response(null))));

    expect(error.message).toBe("The model provider returned an empty stream.");
    expect(error.details).toMatchObject({ reason: "chat-completions-empty-stream" });
  });
});

describe("listOpenAiCompatibleModelIds", () => {
  it("rejects a models response without data", async () => {
    const http = clientFor(() => Response.json({ models: [] }));

    const error = await failure(listOpenAiCompatibleModelIds(http));

    expect(error.message).toBe("The model provider returned an invalid models response.");
  });
});
