import { IxplorerError, IxplorerErrorCode } from "../../shared/errors";
import { ApiFormat } from "../../shared/types";
import type { PluginRequestLogger } from "../../settings/debugLogger";

export interface ProviderHttpClientOptions {
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
  unavailableCode: Extract<
    IxplorerErrorCode,
    "MODEL_PROVIDER_UNAVAILABLE" | "EMBEDDING_UNAVAILABLE"
  >;
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

  async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = `${this.baseUrl}${path}`;
    const method = init.method ?? "GET";
    const requestInit = withAuthorization(init, this.apiKey);
    const logContext = createLogContext(url, method, requestInit);

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

      if (response.status === 404) {
        throw new IxplorerError({ code: "MODEL_NOT_FOUND" });
      }

      if (!response.ok) {
        throw new IxplorerError({
          code: this.unavailableCode,
          message: `Provider returned HTTP ${response.status}.`,
          details: { status: response.status },
        });
      }

      return response;
    } catch (error) {
      if (error instanceof IxplorerError) {
        this.logger?.logError(error, logContext);
        throw error;
      }

      const wrappedError = new IxplorerError({
        code: this.unavailableCode,
        message: this.unavailableMessage,
        cause: error,
      });
      this.logger?.logError(wrappedError, logContext);
      throw wrappedError;
    } finally {
      clearTimeout(timeout);
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
      const wrappedError = new IxplorerError({
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

function createLogContext(url: string, method: string, init: RequestInit) {
  return {
    url,
    method,
    headers: redactHeaders(headersToRecord(init.headers)),
    requestBody: summarizeBody(init.body),
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

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
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
