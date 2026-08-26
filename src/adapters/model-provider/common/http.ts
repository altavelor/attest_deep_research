import { AttestError, AttestErrorCode } from "@core/errors";
import { ApiFormat } from "@core/agent";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";

export interface ProviderHttpClientOptions {
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
  unavailableCode: Extract<AttestErrorCode, "MODEL_PROVIDER_UNAVAILABLE" | "EMBEDDING_UNAVAILABLE">;
  unavailableMessage: string;
}

export class ProviderHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly logger?: PluginRequestLogger;
  private readonly responseContexts = new WeakMap<Response, ReturnType<typeof createLogContext>>();
  private readonly unavailableCode: ProviderHttpClientOptions["unavailableCode"];
  private readonly unavailableMessage: string;
  private readonly apiKey?: string;

  constructor(options: ProviderHttpClientOptions) {
    this.baseUrl = normalizeProviderBaseUrl(options.apiFormat, options.baseUrl);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.logger = options.logger;
    this.unavailableCode = options.unavailableCode;
    this.unavailableMessage = options.unavailableMessage;
  }

  async request(
    path: string,
    init: RequestInit,
    logging: { redactBody?: boolean } = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    if (externalSignal?.aborted) abortFromExternal();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("The provider request timed out.", "TimeoutError"));
    }, this.timeoutMs);
    const url = `${this.baseUrl}${path}`;
    const method = init.method ?? "GET";
    const requestInit = withAuthorization(init, this.apiKey);
    const logContext = createLogContext(url, method, requestInit, logging.redactBody === true);

    try {
      this.logger?.logRequest(logContext);

      const response = await this.fetchImpl.call(globalThis, url, {
        ...requestInit,
        signal: controller.signal,
      });
      this.responseContexts.set(response, logContext);
      this.logger?.logResponse({
        ...logContext,
        status: response.status,
        statusText: response.statusText,
      });

      const providerError = !response.ok
        ? await readProviderError(response, this.apiKey)
        : undefined;
      if (providerError) {
        this.logger?.logResponse({
          ...logContext,
          status: response.status,
          statusText: response.statusText,
          responseBody: { error: providerError },
        });
      }

      if (response.status === 404) {
        throw new AttestError({
          code: "MODEL_NOT_FOUND",
          details: { status: response.status, ...providerErrorDetails(providerError) },
        });
      }

      if (!response.ok) {
        throw new AttestError({
          code: this.unavailableCode,
          message: `Provider returned HTTP ${response.status}.`,
          details: { status: response.status, ...providerErrorDetails(providerError) },
        });
      }

      return response;
    } catch (error) {
      if (error instanceof AttestError) {
        this.logger?.logError(error, logContext);
        throw error;
      }

      if (externalSignal?.aborted && !timedOut) {
        throw externalSignal.reason instanceof Error ? externalSignal.reason : abortError();
      }

      const wrappedError = new AttestError({
        code: this.unavailableCode,
        message: transportFailureMessage(this.unavailableMessage, url, timedOut, error),
        cause: error,
        details: { url: endpointLabel(url), ...(timedOut ? { timedOut: true } : {}) },
      });
      this.logger?.logError(wrappedError, logContext);
      throw wrappedError;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  async readJson(response: Response, invalidJsonMessage: string): Promise<unknown> {
    try {
      const body: unknown = await response.json();
      const logContext = this.responseContexts.get(response) ?? {
        url: response.url,
        method: "UNKNOWN",
      };
      this.logger?.logResponse({
        ...logContext,
        status: response.status,
        statusText: response.statusText,
        responseBody: body,
      });
      return body;
    } catch (error) {
      const wrappedError = new AttestError({
        code: this.unavailableCode,
        message: invalidJsonMessage,
        cause: error,
      });
      this.logger?.logError(wrappedError, {
        url: response.url,
        method: "UNKNOWN",
      });
      throw wrappedError;
    }
  }
}

/**
 * Names the endpoint and the underlying transport failure so a request that
 * never reached the provider is distinguishable from one the provider rejected.
 */
function transportFailureMessage(
  fallback: string,
  url: string,
  timedOut: boolean,
  cause: unknown,
): string {
  const reason = timedOut
    ? "the request timed out"
    : cause instanceof Error && cause.message.trim()
      ? cause.message.trim()
      : undefined;
  return reason ? `${fallback} Could not reach ${endpointLabel(url)} (${reason}).` : fallback;
}

/** Drops any credentials a base URL may carry before the endpoint is shown. */
function endpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function abortError(): Error {
  const error = new Error("The request was aborted.");
  error.name = "AbortError";
  return error;
}

interface ProviderErrorSummary {
  code?: string;
  message?: string;
}

async function readProviderError(
  response: Response,
  apiKey: string | undefined,
): Promise<ProviderErrorSummary | undefined> {
  const text = await readBoundedResponseText(response, 4_096);
  if (!text) return undefined;
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const error = (body as Record<string, unknown>).error;
    if (typeof error !== "object" || error === null || Array.isArray(error)) return undefined;
    const record = error as Record<string, unknown>;
    const code =
      typeof record.code === "string" || typeof record.code === "number"
        ? String(record.code).slice(0, 100)
        : undefined;
    const message =
      typeof record.message === "string"
        ? sanitizeProviderMessage(record.message, apiKey)
        : undefined;
    return code || message
      ? { ...(code ? { code } : {}), ...(message ? { message } : {}) }
      : undefined;
  } catch {
    return undefined;
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: bytes < maxBytes });
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

function sanitizeProviderMessage(value: string, apiKey: string | undefined): string {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 500);
  return apiKey ? normalized.split(apiKey).join("[redacted]") : normalized;
}

function providerErrorDetails(error: ProviderErrorSummary | undefined): Record<string, unknown> {
  return {
    ...(error?.code ? { providerCode: error.code } : {}),
    ...(error?.message ? { providerMessage: error.message } : {}),
  };
}

function normalizeProviderBaseUrl(apiFormat: ApiFormat, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (apiFormat === "ollama" && !trimmed.endsWith("/api")) {
    return `${trimmed}/api`;
  }

  return trimmed;
}

function withAuthorization(init: RequestInit, apiKey: string | undefined): RequestInit {
  if (!apiKey) {
    return init;
  }

  return {
    ...init,
    headers: {
      ...headersToRecord(init.headers),
      Authorization: `Bearer ${apiKey}`,
    },
  };
}

export function createLogContext(
  url: string,
  method: string,
  init: RequestInit,
  redactBody: boolean,
) {
  return {
    url,
    method,
    headers: redactHeaders(headersToRecord(init.headers)),
    requestBody:
      redactBody && init.body ? "[redacted sensitive provider body]" : summarizeBody(init.body),
  };
}

function redactHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      key.toLowerCase() === "authorization" || key.toLowerCase().includes("api-key")
        ? "[redacted]"
        : value,
    ]),
  );
}

export function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    const values: Record<string, string> = {};
    headers.forEach((value, key) => {
      values[key] = value;
    });
    return values;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

function summarizeBody(body: BodyInit | null | undefined): unknown {
  if (typeof body === "string") {
    return tryParseJson(body);
  }

  return body ? "[non-string body]" : undefined;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
