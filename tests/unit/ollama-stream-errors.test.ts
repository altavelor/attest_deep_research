import type { Ollama } from "ollama";

import { ChatRequest, ChatResponseChunk, ModelStreamEvent } from "@core/agent";
import { IxplorerError } from "@core/errors";
import {
  listOllamaModels,
  streamOllamaChat,
} from "@adapters/model-provider/chat/streaming/ollamaChatStream";

interface FakeStream {
  abort: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
}

function fakeOllama(parts: unknown[] | (() => AsyncIterable<unknown>)): Ollama & FakeStream {
  const abort = vi.fn();
  const iterable =
    typeof parts === "function"
      ? parts
      : async function* () {
          for (const part of parts) yield part;
        };
  const stream = {
    abort,
    [Symbol.asyncIterator]: () => iterable()[Symbol.asyncIterator](),
  };
  const chat = vi.fn().mockResolvedValue(stream);
  return { abort, chat } as unknown as Ollama & FakeStream;
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return { model: "gemma", messages: [{ role: "user", content: "hi" }], ...overrides };
}

async function collect(stream: AsyncIterable<ChatResponseChunk>): Promise<ChatResponseChunk[]> {
  const chunks: ChatResponseChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function eventsOf(chunks: ChatResponseChunk[]): ModelStreamEvent[] {
  return chunks.flatMap((chunk) => chunk.events ?? []);
}

describe("ollama chat stream error handling", () => {
  it("ignores chunks with no usable message payload", async () => {
    const ollama = fakeOllama([
      {},
      { message: {} },
      { message: { role: "assistant", content: "" } },
      { message: { role: "assistant", content: "" }, done: true },
    ]);

    const chunks = await collect(streamOllamaChat({ ollama, request: request() }));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ isComplete: true });
    expect(eventsOf(chunks)).toEqual([{ type: "complete", stopReason: "complete" }]);
  });

  it("closes an open reasoning segment when the provider stops without content", async () => {
    const ollama = fakeOllama([
      { message: { role: "assistant", thinking: "Plan" } },
      { message: { role: "assistant", content: "" }, done: true },
    ]);

    const chunks = await collect(
      streamOllamaChat({ ollama, request: request({ reasoningEnabled: true }) }),
    );

    expect(eventsOf(chunks)).toEqual([
      { type: "reasoning-start", segmentId: "reasoning-0", visibility: "text" },
      { type: "reasoning-delta", segmentId: "reasoning-0", text: "Plan" },
      { type: "reasoning-end", segmentId: "reasoning-0" },
      { type: "complete", stopReason: "complete" },
    ]);
  });

  it("completes the stream when the provider never sets done", async () => {
    const ollama = fakeOllama([{ message: { role: "assistant", content: "partial" } }]);

    const chunks = await collect(streamOllamaChat({ ollama, request: request() }));

    expect(chunks.at(-1)).toMatchObject({ isComplete: true, content: "" });
    expect(chunks.at(-1)!.events).toEqual([{ type: "complete", stopReason: "complete" }]);
  });

  it("ends a looping stream early instead of consuming it forever", async () => {
    let emitted = 0;
    const ollama = fakeOllama(async function* () {
      for (;;) {
        emitted += 1;
        yield { message: { role: "assistant", content: "The same repeated sentence again.\n" } };
      }
    });

    const chunks = await collect(streamOllamaChat({ ollama, request: request() }));

    expect(chunks.at(-1)!.isComplete).toBe(true);
    expect(emitted).toBeLessThan(20);
  });

  it("translates a mid-stream provider failure into a typed error", async () => {
    const ollama = fakeOllama(async function* () {
      yield { message: { role: "assistant", content: "half " } };
      throw { status_code: 500, error: "internal   failure  with key sk-secret" };
    });

    const iterator = streamOllamaChat({
      ollama,
      apiKey: "sk-secret",
      request: request(),
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    const failure: unknown = await iterator.next().then(
      () => new Error("the stream did not fail"),
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(IxplorerError);
    expect(failure).toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      details: { status: 500, providerMessage: "internal failure with key [redacted]" },
    });
  });

  it("maps a missing model to a typed not-found error", async () => {
    const ollama = fakeOllama([]);
    ollama.chat.mockRejectedValue({ status_code: 404, error: "model not found" });

    await expect(
      streamOllamaChat({ ollama, request: request() })[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND", details: { status: 404 } });
  });

  it("keeps an already typed error unchanged", async () => {
    const original = new IxplorerError({ code: "UNSUPPORTED_CAPABILITY" });
    const ollama = fakeOllama([]);
    ollama.chat.mockRejectedValue(original);

    await expect(
      streamOllamaChat({ ollama, request: request() })[Symbol.asyncIterator]().next(),
    ).rejects.toBe(original);
  });

  it("reports an unavailable provider without details when the failure is opaque", async () => {
    const ollama = fakeOllama([]);
    ollama.chat.mockRejectedValue(new TypeError("fetch failed"));

    const failure: unknown = await streamOllamaChat({ ollama, request: request() })
      [Symbol.asyncIterator]()
      .next()
      .then(
        () => new Error("the stream did not fail"),
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(IxplorerError);
    expect((failure as IxplorerError).code).toBe("MODEL_PROVIDER_UNAVAILABLE");
    expect((failure as IxplorerError).details).toBeUndefined();
  });

  it("propagates an abort as-is rather than wrapping it", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const ollama = fakeOllama(async function* () {
      yield { message: { role: "assistant", content: "half" } };
      throw abortError;
    });

    const iterator = streamOllamaChat({ ollama, request: request() })[Symbol.asyncIterator]();
    await iterator.next();

    await expect(iterator.next()).rejects.toBe(abortError);
  });

  it("aborts the provider stream when the caller cancels mid-stream", async () => {
    const controller = new AbortController();
    const ollama = fakeOllama(async function* () {
      yield { message: { role: "assistant", content: "one" } };
      yield { message: { role: "assistant", content: "two" }, done: true };
    });

    const iterator = streamOllamaChat({
      ollama,
      request: request({ signal: controller.signal }),
    })[Symbol.asyncIterator]();
    await iterator.next();
    expect(ollama.abort).not.toHaveBeenCalled();

    controller.abort();

    expect(ollama.abort).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately when the request signal is already aborted", async () => {
    const ollama = fakeOllama([{ message: { role: "assistant", content: "x" }, done: true }]);

    await collect(streamOllamaChat({ ollama, request: request({ signal: AbortSignal.abort() }) }));

    expect(ollama.abort).toHaveBeenCalledTimes(1);
  });

  it("rejects tool choices the provider cannot honour before contacting it", async () => {
    const ollama = fakeOllama([]);

    await expect(
      streamOllamaChat({
        ollama,
        request: request({ toolChoice: { type: "required" } }),
      })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    expect(ollama.chat).not.toHaveBeenCalled();
  });
});

describe("listing ollama models", () => {
  it("drops entries without a usable name", async () => {
    const ollama = {
      list: vi.fn().mockResolvedValue({
        models: [{ name: "a", model: "a" }, { name: "", model: "b" }, { model: undefined }],
      }),
    } as unknown as Ollama;

    await expect(listOllamaModels(ollama, undefined)).resolves.toEqual(["a", "b"]);
  });

  it("translates a listing failure into a typed error", async () => {
    const ollama = {
      list: vi.fn().mockRejectedValue({ status_code: 401, error: "unauthorized token abc" }),
    } as unknown as Ollama;

    await expect(listOllamaModels(ollama, "abc")).rejects.toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      details: { status: 401, providerMessage: "unauthorized token [redacted]" },
    });
  });
});
