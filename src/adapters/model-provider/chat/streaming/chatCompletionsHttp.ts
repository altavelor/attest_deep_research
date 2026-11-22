import { isRecord } from "@shared";
import { AttestError } from "@core/errors";
import { ProviderHttpClient } from "../../common/http";
import { isOpenAiModelsResponse, modelNamesFromOpenAiModels } from "../../common/models";
import { parseServerSentEvents } from "../../common/streams";

/**
 * Posts a streaming Chat Completions request and yields each SSE chunk as a JSON object until `[DONE]`.
 * Malformed frames and mid-stream provider errors surface as `MODEL_PROVIDER_UNAVAILABLE`.
 */
export async function openChatCompletionsStream(
  http: ProviderHttpClient,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AsyncIterable<Record<string, unknown>>> {
  const response = await http.request("/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.body) {
    throw new AttestError({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      message: "The model provider returned an empty stream.",
      details: { reason: "chat-completions-empty-stream" },
    });
  }
  return chatCompletionChunks(response.body, http, signal);
}

async function* chatCompletionChunks(
  body: ReadableStream<Uint8Array>,
  http: ProviderHttpClient,
  signal: AbortSignal | undefined,
): AsyncIterable<Record<string, unknown>> {
  const events = parseServerSentEvents(body, signal);
  const iterator = events[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await readNextEvent(iterator, signal);
      if (next.done || next.value === "[DONE]") return;
      const chunk = parseChunk(next.value);
      if (chunk.error != null) throw midStreamError(chunk.error, http);
      yield chunk;
    }
  } finally {
    await iterator.return?.();
  }
}

async function readNextEvent(
  iterator: AsyncIterator<string>,
  signal: AbortSignal | undefined,
): Promise<IteratorResult<string>> {
  try {
    return await iterator.next();
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof AttestError) throw error;
    throw new AttestError({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      message: "The model provider stream failed.",
      cause: error,
    });
  }
}

function parseChunk(data: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw invalidFrame(error);
  }
  if (!isRecord(parsed)) throw invalidFrame();
  return parsed;
}

function invalidFrame(cause?: unknown): AttestError {
  return new AttestError({
    code: "MODEL_PROVIDER_UNAVAILABLE",
    message: "The model provider returned an invalid stream frame.",
    cause,
    details: { reason: "chat-completions-invalid-sse-json" },
  });
}

function midStreamError(error: unknown, http: ProviderHttpClient): AttestError {
  const message = isRecord(error) && typeof error.message === "string" ? error.message : undefined;
  const providerMessage = message ? http.sanitizeProviderMessage(message) : undefined;
  return new AttestError({
    code: "MODEL_PROVIDER_UNAVAILABLE",
    message: "Provider returned an error mid-stream.",
    details: providerMessage ? { providerMessage } : {},
  });
}

/** Lists the non-empty model ids an OpenAI-compatible server reports at `GET /models`. */
export async function listOpenAiCompatibleModelIds(http: ProviderHttpClient): Promise<string[]> {
  const response = await http.request("/models", { method: "GET" });
  const body = await http.readJson(response, "The model provider returned invalid JSON.");
  if (!isOpenAiModelsResponse(body)) {
    throw new AttestError({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      message: "The model provider returned an invalid models response.",
    });
  }
  return modelNamesFromOpenAiModels(body).filter((id) => id.length > 0);
}
