import Anthropic, { APIError, APIUserAbortError } from "@anthropic-ai/sdk";

import { AttestError, AttestErrorCode } from "@core/errors";
import { fetchTransportOrUnavailable, isRecord } from "@shared";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { createLogContext, headersToRecord } from "../../common/http";

type UnavailableCode = Extract<
  AttestErrorCode,
  "MODEL_PROVIDER_UNAVAILABLE" | "EMBEDDING_UNAVAILABLE"
>;

export interface AnthropicClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
}

/**
 * Builds an official Anthropic SDK client. The SDK owns the HTTP/SSE protocol,
 * extended-thinking decoding, and tool-use streaming; we inject a fetch wrapper
 * so the plugin keeps its request/response debug logging and the global-receiver
 * invocation that Obsidian's fetch requires.
 *
 * The configured base URL may include a trailing `/v1` (the plugin stores it
 * that way for the legacy transport); the SDK appends its own `/v1/...` paths,
 * so the trailing version segment is stripped to avoid a doubled `/v1/v1`.
 */
export function createAnthropicClient(options: AnthropicClientOptions): Anthropic {
  const baseURL = normalizeAnthropicBaseUrl(options.baseUrl);
  const hasApiKey = typeof options.apiKey === "string" && options.apiKey.length > 0;

  return new Anthropic({
    baseURL,
    apiKey: hasApiKey ? (options.apiKey as string) : "missing",
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: options.timeoutMs ?? 30_000,
    fetch: createLoggingFetch(fetchTransportOrUnavailable(options.fetch), {
      logger: options.logger,
      ...(hasApiKey ? {} : { stripHeader: "x-api-key" }),
    }),
  });
}

export function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/v\d+$/, "");
}

export interface LoggingFetchOptions {
  logger?: PluginRequestLogger;
  stripHeader?: string;
}

/**
 * Wraps a fetch implementation so provider requests keep flowing through the
 * plugin's debug logging and Obsidian's global receiver. Shared by the Anthropic
 * SDK and the Ollama SDK transports.
 */
export function createLoggingFetch(
  baseFetch: typeof fetch,
  options: LoggingFetchOptions,
): typeof fetch {
  const stripHeader = options.stripHeader?.toLowerCase();
  return async function loggingFetch(input, init) {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const effectiveInit = stripHeader ? withoutHeader(init, stripHeader) : (init ?? {});
    const logContext = createLogContext(url, method, effectiveInit, false);

    options.logger?.logRequest(logContext);

    const response = await baseFetch.call(globalThis, input, stripHeader ? effectiveInit : init);

    options.logger?.logResponse({
      ...logContext,
      status: response.status,
      statusText: response.statusText,
    });

    return response;
  } as typeof fetch;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function withoutHeader(init: RequestInit | undefined, headerName: string): RequestInit {
  const headers = headersToRecord(init?.headers);
  if (!headers) return init ?? {};
  const stripped: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === headerName) continue;
    stripped[key] = value;
  }
  return { ...init, headers: stripped };
}

export interface AnthropicErrorTranslation {
  unavailableCode: UnavailableCode;
  unavailableMessage: string;
  apiKey?: string;
}

/**
 * Converts SDK errors into the plugin's AttestError taxonomy (MODEL_NOT_FOUND
 * on 404, the supplied unavailable code otherwise). User aborts are re-thrown
 * unchanged so the research loop can treat them as cancellations.
 */
export function translateAnthropicError(
  error: unknown,
  translation: AnthropicErrorTranslation,
): AttestError | never {
  if (error instanceof AttestError) return error;
  if (
    error instanceof APIUserAbortError ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    throw error;
  }

  if (error instanceof APIError) {
    const status = error.status;
    const details = providerErrorDetails(error, translation.apiKey);
    if (status === 404) {
      return new AttestError({ code: "MODEL_NOT_FOUND", details: { status, ...details } });
    }
    if (typeof status === "number") {
      return new AttestError({
        code: translation.unavailableCode,
        message: `Provider returned HTTP ${status}.`,
        details: { status, ...details },
      });
    }
  }

  return new AttestError({
    code: translation.unavailableCode,
    message: translation.unavailableMessage,
    cause: error,
  });
}

function providerErrorDetails(
  error: APIError,
  apiKey: string | undefined,
): Record<string, unknown> {
  const code =
    isRecord(error.error) && typeof error.error.type === "string"
      ? error.error.type.slice(0, 100)
      : undefined;
  const rawMessage =
    isRecord(error.error) &&
    isRecord(error.error.error) &&
    typeof error.error.error.message === "string"
      ? error.error.error.message
      : undefined;
  const message = rawMessage ? sanitizeProviderMessage(rawMessage, apiKey) : undefined;
  return {
    ...(code ? { providerCode: code } : {}),
    ...(message ? { providerMessage: message } : {}),
  };
}

function sanitizeProviderMessage(value: string, apiKey: string | undefined): string {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 500);
  return apiKey ? normalized.split(apiKey).join("[redacted]") : normalized;
}
