import { ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";
import { ModelWebQueryIntentClassifier } from "@application/web";

function modelReturning(
  content: string,
  onRequest?: (request: ChatRequest) => void,
): ChatModelProvider {
  return {
    listModels: async () => ["m"],
    streamChat: async function* (request: ChatRequest): AsyncIterable<ChatResponseChunk> {
      onRequest?.(request);
      yield { content, isComplete: true };
    },
  };
}

function hangingModel(onAbort?: () => void): ChatModelProvider {
  return {
    listModels: async () => ["m"],
    streamChat: (request: ChatRequest): AsyncIterable<ChatResponseChunk> => ({
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<ChatResponseChunk>>((_resolve, reject) => {
            request.signal?.addEventListener("abort", () => {
              onAbort?.();
              reject(new Error("aborted"));
            });
          }),
      }),
    }),
  };
}

describe("ModelWebQueryIntentClassifier", () => {
  it("uses the model's answer when it is valid JSON", async () => {
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: modelReturning('{"intent":"academic"}'),
      model: "m",
    });

    await expect(classifier.classify("anything")).resolves.toEqual({
      intent: "academic",
      origin: "model",
    });
  });

  it("accepts a bare intent word and rejects an unknown one", async () => {
    const bare = new ModelWebQueryIntentClassifier({
      chatModel: modelReturning("news"),
      model: "m",
    });
    await expect(bare.classify("anything")).resolves.toMatchObject({
      intent: "news",
      origin: "model",
    });

    const nonsense = new ModelWebQueryIntentClassifier({
      chatModel: modelReturning('{"intent":"astrology"}'),
      model: "m",
    });
    await expect(nonsense.classify("latest release news")).resolves.toMatchObject({
      intent: "news",
      origin: "heuristic",
      reason: "unparsable-intent",
    });
  });

  it("degrades to the heuristic when the model throws", async () => {
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: {
        listModels: async () => ["m"],
        // eslint-disable-next-line require-yield
        streamChat: async function* (): AsyncIterable<ChatResponseChunk> {
          throw new Error("provider down");
        },
      },
      model: "m",
    });

    await expect(classifier.classify("arxiv paper on RAG")).resolves.toEqual({
      intent: "academic",
      origin: "heuristic",
      reason: "provider down",
    });
  });

  it("degrades to the heuristic on timeout and aborts the model call", async () => {
    let aborted = false;
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: hangingModel(() => {
        aborted = true;
      }),
      model: "m",
      timeoutMs: 10,
    });

    const resolution = await classifier.classify("arxiv paper on RAG");
    expect(resolution).toMatchObject({ intent: "academic", origin: "heuristic" });
    expect(aborted).toBe(true);
  });

  it("degrades to the heuristic even when the provider ignores the abort signal", async () => {
    const deaf: ChatModelProvider = {
      listModels: async () => ["m"],
      streamChat: (): AsyncIterable<ChatResponseChunk> => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<ChatResponseChunk>>(() => {}),
        }),
      }),
    };
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: deaf,
      model: "m",
      timeoutMs: 10,
    });

    await expect(classifier.classify("arxiv paper on RAG")).resolves.toEqual({
      intent: "academic",
      origin: "heuristic",
      reason: "intent-classification-timeout",
    });
  });

  it("stops waiting on a deaf provider when the caller cancels", async () => {
    const controller = new AbortController();
    const deaf: ChatModelProvider = {
      listModels: async () => ["m"],
      streamChat: (): AsyncIterable<ChatResponseChunk> => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<ChatResponseChunk>>(() => {}),
        }),
      }),
    };
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: deaf,
      model: "m",
      timeoutMs: 60_000,
    });

    const pending = classifier.classify("latest release news", controller.signal);
    controller.abort();

    await expect(pending).resolves.toMatchObject({ intent: "news", origin: "heuristic" });
  });

  it("closes the abandoned stream so the provider can release it", async () => {
    let returned = false;
    const deaf: ChatModelProvider = {
      listModels: async () => ["m"],
      streamChat: (): AsyncIterable<ChatResponseChunk> => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<ChatResponseChunk>>(() => {}),
          return: async () => {
            returned = true;
            return { done: true, value: undefined } as IteratorResult<ChatResponseChunk>;
          },
        }),
      }),
    };
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: deaf,
      model: "m",
      timeoutMs: 10,
    });

    await classifier.classify("arxiv paper on RAG");

    expect(returned).toBe(true);
  });

  it("never reaches the model when the caller already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: modelReturning('{"intent":"code"}', () => {
        calls += 1;
      }),
      model: "m",
    });

    await expect(
      classifier.classify("latest release news", controller.signal),
    ).resolves.toMatchObject({ intent: "news", origin: "heuristic", reason: "aborted" });
    expect(calls).toBe(0);
  });

  it("degrades to the heuristic when the caller cancels", async () => {
    const controller = new AbortController();
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: hangingModel(),
      model: "m",
      timeoutMs: 5_000,
    });

    const pending = classifier.classify("latest release news", controller.signal);
    controller.abort();

    await expect(pending).resolves.toMatchObject({ intent: "news", origin: "heuristic" });
  });

  it("serves a repeated query from cache and re-asks once the entry expires", async () => {
    let calls = 0;
    let clock = 0;
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: modelReturning('{"intent":"code"}', () => {
        calls += 1;
      }),
      model: "m",
      cacheTtlMs: 1_000,
      now: () => clock,
    });

    await classifier.classify("Typescript error");
    await expect(classifier.classify("  typescript   ERROR ")).resolves.toMatchObject({
      intent: "code",
      reason: "cached",
    });
    expect(calls).toBe(1);

    clock = 2_000;
    await classifier.classify("Typescript error");
    expect(calls).toBe(2);
  });

  it("keeps a recently used entry and evicts the least recently used one", async () => {
    let calls = 0;
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: modelReturning('{"intent":"general"}', () => {
        calls += 1;
      }),
      model: "m",
      maxCacheEntries: 2,
    });

    await classifier.classify("one");
    await classifier.classify("two");
    expect(calls).toBe(2);

    await classifier.classify("one");
    expect(calls).toBe(2);

    await classifier.classify("three");
    expect(calls).toBe(3);

    await classifier.classify("one");
    expect(calls).toBe(3);

    await classifier.classify("two");
    expect(calls).toBe(4);
  });

  it("evicts the oldest entry once the cache is full", async () => {
    let calls = 0;
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: modelReturning('{"intent":"general"}', () => {
        calls += 1;
      }),
      model: "m",
      maxCacheEntries: 2,
    });

    await classifier.classify("one");
    await classifier.classify("two");
    await classifier.classify("three");
    expect(calls).toBe(3);

    await classifier.classify("one");
    expect(calls).toBe(4);

    await classifier.classify("three");
    expect(calls).toBe(4);
  });

  it("never calls the model for an empty query", async () => {
    let calls = 0;
    const classifier = new ModelWebQueryIntentClassifier({
      chatModel: modelReturning('{"intent":"code"}', () => {
        calls += 1;
      }),
      model: "m",
    });

    await expect(classifier.classify("   ")).resolves.toEqual({
      intent: "general",
      origin: "heuristic",
      reason: "empty-query",
    });
    expect(calls).toBe(0);
  });
});
