import { ChatModelProvider, ChatResponseChunk } from "@core/agent";
import { classifyWebQuery, isWebQueryIntent, WEB_QUERY_INTENTS, WebQueryIntent } from "@core/web";
import { ScheduledTimeout, scheduleTimeout } from "@shared";

export type WebQueryIntentOrigin = "explicit" | "model" | "heuristic";

export interface WebQueryIntentResolution {
  intent: WebQueryIntent;
  origin: WebQueryIntentOrigin;

  reason?: string;
}

export interface WebQueryIntentClassifier {
  classify(query: string, signal?: AbortSignal): Promise<WebQueryIntentResolution>;
}

export interface ModelWebQueryIntentClassifierOptions {
  chatModel: ChatModelProvider;
  model: string;

  timeoutMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 64;

const SYSTEM_PROMPT = `You classify a web search query into exactly one intent.
Intents: ${WEB_QUERY_INTENTS.join(", ")}.
Answer with JSON only: {"intent":"<one of the intents>"}. No prose.`;

/**
 * Resolves a query intent with the chat model and degrades to the deterministic
 * heuristic on timeout, cancellation, an unusable answer, or any provider error.
 * Results are cached by normalized query text so repeated queries cost nothing.
 */
export class ModelWebQueryIntentClassifier implements WebQueryIntentClassifier {
  private readonly cache = new Map<string, { intent: WebQueryIntent; expiresAt: number }>();

  constructor(private readonly options: ModelWebQueryIntentClassifierOptions) {}

  async classify(query: string, signal?: AbortSignal): Promise<WebQueryIntentResolution> {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    if (key.length === 0) {
      return { intent: "general", origin: "heuristic", reason: "empty-query" };
    }

    const cached = this.readCache(key);
    if (cached) {
      return { intent: cached, origin: "model", reason: "cached" };
    }

    try {
      const intent = await this.askModel(query, signal);
      this.writeCache(key, intent);
      return { intent, origin: "model" };
    } catch (error) {
      return {
        intent: classifyWebQuery(query),
        origin: "heuristic",
        reason: classifierFailureReason(error),
      };
    }
  }

  /**
   * Races the model against the deadline instead of trusting it to honour the
   * abort signal: a provider that ignores cancellation would otherwise stall the
   * whole web phase. The losing stream is closed through its iterator so the
   * provider still runs its own cleanup.
   */
  private async askModel(query: string, signal?: AbortSignal): Promise<WebQueryIntent> {
    if (signal?.aborted === true) {
      throw new Error("aborted");
    }
    const controller = new AbortController();
    let timer: ScheduledTimeout | undefined;
    let abortOuter: (() => void) | undefined;
    let stream: AsyncIterator<ChatResponseChunk> | undefined;

    const abandoned = new Promise<never>((_resolve, reject) => {
      const give = (reason: string): void => {
        controller.abort();
        reject(new Error(reason));
      };
      timer = scheduleTimeout(
        () => give("intent-classification-timeout"),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      abortOuter = () => give("aborted");
      if (signal?.aborted === true) {
        give("aborted");
      } else {
        signal?.addEventListener("abort", abortOuter, { once: true });
      }
    });
    abandoned.catch(() => undefined);

    const streamed = this.streamIntent(query, controller.signal, (iterator) => {
      stream = iterator;
    });
    streamed.catch(() => undefined);

    try {
      return await Promise.race([streamed, abandoned]);
    } finally {
      timer?.cancel();
      if (abortOuter) {
        signal?.removeEventListener("abort", abortOuter);
      }
      controller.abort();
      void Promise.resolve(stream?.return?.(undefined)).catch(() => undefined);
    }
  }

  private async streamIntent(
    query: string,
    signal: AbortSignal,
    adopt: (iterator: AsyncIterator<ChatResponseChunk>) => void,
  ): Promise<WebQueryIntent> {
    const response = this.options.chatModel.streamChat({
      model: this.options.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      temperature: 0,
      maxTokens: 32,
      reasoningEnabled: false,
      signal,
    });
    const stream = response[Symbol.asyncIterator]();
    adopt(stream);

    let content = "";
    for (;;) {
      const next = await stream.next();
      if (next.done === true) {
        break;
      }
      content += next.value.content;
      if (next.value.isComplete) {
        break;
      }
    }
    const intent = parseIntent(content);
    if (!intent) {
      throw new Error("unparsable-intent");
    }
    return intent;
  }

  private readCache(key: string): WebQueryIntent | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    this.cache.delete(key);
    if (entry.expiresAt <= this.now()) {
      return undefined;
    }
    this.cache.set(key, entry);
    return entry.intent;
  }

  private writeCache(key: string, intent: WebQueryIntent): void {
    const maxEntries = this.options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    this.cache.delete(key);
    this.cache.set(key, {
      intent,
      expiresAt: this.now() + (this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
    });
    while (this.cache.size > maxEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.cache.delete(oldest.value);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function parseIntent(content: string): WebQueryIntent | undefined {
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      const intent = (parsed as { intent?: unknown } | null)?.intent;
      if (isWebQueryIntent(intent)) {
        return intent;
      }
    } catch {
      return bareWordIntent(content);
    }
  }
  return bareWordIntent(content);
}

function bareWordIntent(content: string): WebQueryIntent | undefined {
  const bare = content
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return isWebQueryIntent(bare) ? bare : undefined;
}

function classifierFailureReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "classifier-failed";
}
