import { IxplorerError } from "../shared/errors";
import {
  ChatModelClient,
  ChatRequest,
  ChatResponseChunk,
  EmbeddingClient,
  EmbeddingRequest,
  EmbeddingResponse,
} from "../shared/types";

export interface LmStudioClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface ModelsResponse {
  data: Array<{ id: string }>;
}

interface EmbeddingsResponse {
  model?: string;
  data: Array<{ embedding: number[] }>;
}

export class LmStudioClient implements ChatModelClient, EmbeddingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: LmStudioClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async listModels(): Promise<string[]> {
    const response = await this.request("/models", { method: "GET" }, "MODEL_PROVIDER_UNAVAILABLE");
    const body = await readJson(response, "MODEL_PROVIDER_UNAVAILABLE");

    if (!isModelsResponse(body)) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "LM Studio returned an invalid models response.",
      });
    }

    return body.data.map((model) => model.id);
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    const response = await this.request(
      "/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, stream: true }),
      },
      "MODEL_PROVIDER_UNAVAILABLE",
    );

    if (!response.body) {
      throw new IxplorerError({
        code: "MODEL_PROVIDER_UNAVAILABLE",
        message: "LM Studio returned an empty chat stream.",
      });
    }

    for await (const event of parseServerSentEvents(response.body)) {
      if (event === "[DONE]") {
        yield { content: "", isComplete: true };
        return;
      }

      const content = parseChatDelta(event);
      if (content) {
        yield { content, isComplete: false };
      }
    }

    yield { content: "", isComplete: true };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await this.request(
      "/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
      "EMBEDDING_UNAVAILABLE",
    );
    const body = await readJson(response, "EMBEDDING_UNAVAILABLE");

    if (!isEmbeddingsResponse(body)) {
      throw new IxplorerError({
        code: "EMBEDDING_UNAVAILABLE",
        message: "LM Studio returned an invalid embeddings response.",
      });
    }

    return {
      model: body.model ?? request.model,
      embeddings: body.data.map((item) => item.embedding),
    };
  }

  private async request(
    path: string,
    init: RequestInit,
    unavailableCode: "MODEL_PROVIDER_UNAVAILABLE" | "EMBEDDING_UNAVAILABLE",
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });

      if (response.status === 404) {
        throw new IxplorerError({ code: "MODEL_NOT_FOUND" });
      }

      if (!response.ok) {
        throw new IxplorerError({
          code: unavailableCode,
          message: `LM Studio returned HTTP ${response.status}.`,
          details: { status: response.status },
        });
      }

      return response;
    } catch (error) {
      if (error instanceof IxplorerError) {
        throw error;
      }

      throw new IxplorerError({
        code: unavailableCode,
        message: "LM Studio is unavailable.",
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readJson(
  response: Response,
  errorCode: "MODEL_PROVIDER_UNAVAILABLE" | "EMBEDDING_UNAVAILABLE",
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new IxplorerError({
      code: errorCode,
      message: "LM Studio returned invalid JSON.",
      cause: error,
    });
  }
}

function isModelsResponse(value: unknown): value is ModelsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every((item) => isRecord(item) && typeof item.id === "string")
  );
}

function isEmbeddingsResponse(value: unknown): value is EmbeddingsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every(
      (item) =>
        isRecord(item) &&
        Array.isArray(item.embedding) &&
        item.embedding.every((dimension) => typeof dimension === "number"),
    )
  );
}

function parseChatDelta(event: string): string {
  try {
    const parsed: unknown = JSON.parse(event);
    if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
      return "";
    }

    const firstChoice: unknown = parsed.choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
      return "";
    }

    return typeof firstChoice.delta.content === "string" ? firstChoice.delta.content : "";
  } catch {
    return "";
  }
}

async function* parseServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const data = parseServerSentEventData(event);
      if (data) {
        yield data;
      }
    }
  }

  buffer += decoder.decode();
  const data = parseServerSentEventData(buffer);
  if (data) {
    yield data;
  }
}

function parseServerSentEventData(event: string): string {
  return event
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
