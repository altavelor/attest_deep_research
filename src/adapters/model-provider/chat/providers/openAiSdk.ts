import OpenAI, { APIError } from "openai";

import { AttestError, AttestErrorCode } from "@core/errors";
import { fetchTransportOrUnavailable, isRecord } from "@shared";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { createLogContext, headersToRecord } from "../../common/http";

type UnavailableCode = Extract<
  AttestErrorCode,
  "MODEL_PROVIDER_UNAVAILABLE" | "EMBEDDING_UNAVAILABLE"
>;

export interface OpenAiClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
}

/**
 * Builds an official OpenAI SDK client pointed at an OpenAI-compatible server
 * (LM Studio, OpenRouter, vLLM, …). The SDK manages the HTTP/SSE protocol; we
 * inject a fetch wrapper so the plugin keeps its request/response debug logging
 * and the global-receiver invocation that Obsidian's fetch requires.
 */
export function createOpenAiClient(options: OpenAiClientOptions): OpenAI {
  const baseURL = options.baseUrl.trim().replace(/\/+$/, "");
  const hasApiKey = typeof options.apiKey === "string" && options.apiKey.length > 0;

  return new OpenAI({
    baseURL,
    apiKey: hasApiKey ? options.apiKey : "lm-studio",
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: options.timeoutMs ?? 30_000,
    fetch: createLoggingFetch(fetchTransportOrUnavailable(options.fetch), {
      logger: options.logger,
      stripAuthorization: !hasApiKey,
    }),
  });
}

interface LoggingFetchOptions {
  logger?: PluginRequestLogger;
  stripAuthorization: boolean;
}

function createLoggingFetch(baseFetch: typeof fetch, options: LoggingFetchOptions): typeof fetch {
  return async function loggingFetch(input, init) {
    const url = requestUrl(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const effectiveInit = options.stripAuthorization ? withoutAuthorization(init) : (init ?? {});
    const logContext = createLogContext(url, method, effectiveInit, false);

    options.logger?.logRequest(logContext);

    const response = await baseFetch(input, options.stripAuthorization ? effectiveInit : init);

    options.logger?.logResponse({
      ...logContext,
      status: response.status,
      statusText: response.statusText,
    });

    return response;
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function withoutAuthorization(init: RequestInit | undefined): RequestInit {
  const headers = headersToRecord(init?.headers);
  if (!headers) return init ?? {};
  const stripped: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") continue;
    stripped[key] = value;
  }
  return { ...init, headers: stripped };
}

export interface OpenAiErrorTranslation {
  unavailableCode: UnavailableCode;
  unavailableMessage: string;
  apiKey?: string;
}

/**
 * Converts SDK errors into the plugin's AttestError taxonomy so the rest of
 * the app keeps reacting to stable codes (MODEL_NOT_FOUND on 404, the supplied
 * unavailable code otherwise).
 */
export function translateOpenAiError(
  error: unknown,
  translation: OpenAiErrorTranslation,
): AttestError {
  if (error instanceof AttestError) return error;

  if (error instanceof APIError) {
    const status: unknown = error.status;
    const details = providerErrorDetails(error, translation.apiKey);
    if (status === 404) {
      return new AttestError({
        code: "MODEL_NOT_FOUND",
        details: { status, ...details },
      });
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

function providerErrorDetails(error: unknown, apiKey: string | undefined): Record<string, unknown> {
  if (!isRecord(error)) return {};
  const code = typeof error.code === "string" ? error.code.slice(0, 100) : undefined;
  const rawMessage =
    isRecord(error.error) && typeof error.error.message === "string"
      ? error.error.message
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
