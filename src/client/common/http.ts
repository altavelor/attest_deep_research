import { IxplorerError, IxplorerErrorCode } from "../../shared/errors";
import { LocalModelProvider } from "../../shared/types";
import type { PluginRequestLogger } from "../../settings/debugLogger";

export interface ProviderHttpClientOptions {
  provider: LocalModelProvider;
  baseUrl: string;
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

  constructor(options: ProviderHttpClientOptions) {
    this.baseUrl = normalizeProviderBaseUrl(options.provider, options.baseUrl);
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
    const logContext = createLogContext(url, method, init);

    try {
      this.logger?.logRequest(logContext);

      const response = await this.fetchImpl(url, {
        ...init,
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

function normalizeProviderBaseUrl(provider: LocalModelProvider, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (provider === "ollama" && !trimmed.endsWith("/api")) {
    return `${trimmed}/api`;
  }

  return trimmed;
}

function createLogContext(url: string, method: string, init: RequestInit) {
  return {
    url,
    method,
    headers: headersToRecord(init.headers),
    requestBody: summarizeBody(init.body),
  };
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
