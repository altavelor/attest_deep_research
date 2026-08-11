import { AttestError } from "@core/errors";
import {
  areCredentialsComplete,
  extractSiteFilters,
  recencyFloor,
  stripTemporalNoise,
} from "@core/web";
import type { WebSourceActivation } from "@core/web";
import { SearchProviderResult, WebSearchOptions, WebSearchSource } from "@application/ports";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { sanitizeParsedResults, WebSourceDefinition, WebSourceQueryInput } from "./types";

export interface HttpWebSearchSourceOptions {
  activation?: WebSourceActivation;
  credentials?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  defaultResultLimit?: number;
  logger?: PluginRequestLogger;
  now?: () => Date;
}

export type WebSourceFailureReason =
  | "not-configured"
  | "unauthorized"
  | "rate-limited"
  | "http"
  | "timeout"
  | "network"
  | "bad-response";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RESULT_LIMIT = 5;
const HARD_RESULT_LIMIT = 25;

export class HttpWebSearchSource implements WebSearchSource {
  readonly descriptor;
  readonly activation: WebSourceActivation;

  private readonly definition: WebSourceDefinition;
  private readonly credentials: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly defaultResultLimit: number;
  private readonly logger?: PluginRequestLogger;
  private readonly now: () => Date;

  constructor(definition: WebSourceDefinition, options: HttpWebSearchSourceOptions = {}) {
    this.definition = definition;
    this.descriptor = definition.descriptor;
    this.activation = options.activation ?? "auto";
    this.credentials = options.credentials ?? {};
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultResultLimit = options.defaultResultLimit ?? DEFAULT_RESULT_LIMIT;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<SearchProviderResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }
    if (!areCredentialsComplete(this.descriptor, this.credentials)) {
      throw this.failure("not-configured", "is not configured.");
    }

    let effectiveQuery = trimmedQuery;
    let domains: string[] = [];
    if (this.definition.supportsSiteOperator !== true) {
      const extracted = extractSiteFilters(effectiveQuery);
      effectiveQuery = extracted.query.length > 0 ? extracted.query : trimmedQuery;
      domains = extracted.domains;
    }
    if (options.recency) {
      effectiveQuery = stripTemporalNoise(effectiveQuery);
    }

    const input: WebSourceQueryInput = {
      query: effectiveQuery,
      limit: clampLimit(options.limit, this.defaultResultLimit),
      credentials: this.credentials,
      ...(options.recency
        ? {
            recency: options.recency,
            freshFrom: recencyFloor(options.recency, this.now()).toISOString(),
          }
        : {}),
      ...(options.language ? { language: options.language } : {}),
      ...(domains.length > 0 ? { domains } : {}),
    };

    const body = await this.execute(
      this.definition.buildRequest(input),
      options.timeoutMs,
      options.signal,
    );
    let parsed;
    try {
      parsed = sanitizeParsedResults(this.definition.parseResponse(body, input));
    } catch (error) {
      throw this.failure("bad-response", "returned an unexpected response.", error);
    }

    const retrievedAt = this.now().toISOString();
    return parsed.slice(0, input.limit).map((result, index) => ({
      source: {
        id: `web:${result.url}`,
        kind: "web" as const,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        retrievedAt,
        wasContentFetched: result.extractedText !== undefined,
      },
      ...(result.extractedText ? { extractedText: result.extractedText } : {}),
      rank: index + 1,
      query: trimmedQuery,
    }));
  }

  private async execute(
    request: ReturnType<WebSourceDefinition["buildRequest"]>,
    timeoutOverrideMs: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutMs =
      typeof timeoutOverrideMs === "number" && timeoutOverrideMs > 0
        ? timeoutOverrideMs
        : this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = (): void => controller.abort();
    if (signal?.aborted === true) {
      controller.abort();
    } else {
      signal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const context = {
      url: request.url,
      method: request.method ?? "GET",
      headers: request.headers ?? {},
    };

    try {
      this.logger?.logRequest(context);
      const response = await this.fetchImpl.call(globalThis, request.url, {
        method: context.method,
        headers: context.headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal: controller.signal,
      });
      this.logger?.logResponse({
        ...context,
        status: response.status,
        statusText: response.statusText,
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw this.httpFailure(response.status);
      }
      return await response.text();
    } catch (error) {
      if (error instanceof AttestError) {
        this.logger?.logError(error, context);
        throw error;
      }
      const wrapped = isAbortError(error)
        ? this.failure("timeout", "timed out.", error)
        : this.failure("network", "request failed.", error);
      this.logger?.logError(wrapped, context);
      throw wrapped;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private httpFailure(status: number): AttestError {
    if (status === 401 || status === 403) {
      return this.failure("unauthorized", `rejected the credentials (HTTP ${status}).`, undefined, {
        status,
      });
    }
    if (status === 429) {
      return this.failure("rate-limited", "rate limit exceeded (HTTP 429).", undefined, { status });
    }
    return this.failure("http", `returned HTTP ${status}.`, undefined, { status });
  }

  /** All failures share WEB_SEARCH_FAILED; details.reason carries the machine-readable cause. */
  private failure(
    reason: WebSourceFailureReason,
    suffix: string,
    cause?: unknown,
    details?: Record<string, unknown>,
  ): AttestError {
    return new AttestError({
      code: "WEB_SEARCH_FAILED",
      message: `${this.descriptor.label} ${suffix}`,
      ...(cause !== undefined ? { cause } : {}),
      details: { sourceId: this.descriptor.id, reason, ...details },
    });
  }
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(value), HARD_RESULT_LIMIT));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
