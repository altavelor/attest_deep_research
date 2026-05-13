import { IxplorerError, IxplorerErrorCode } from "../../shared/errors";
import { LocalModelProvider } from "../../shared/types";

export interface ProviderHttpClientOptions {
  provider: LocalModelProvider;
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
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
  private readonly unavailableCode: ProviderHttpClientOptions["unavailableCode"];
  private readonly unavailableMessage: string;

  constructor(options: ProviderHttpClientOptions) {
    this.baseUrl = normalizeProviderBaseUrl(options.provider, options.baseUrl);
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.unavailableCode = options.unavailableCode;
    this.unavailableMessage = options.unavailableMessage;
  }

  async request(path: string, init: RequestInit): Promise<Response> {
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
          code: this.unavailableCode,
          message: `Provider returned HTTP ${response.status}.`,
          details: { status: response.status },
        });
      }

      return response;
    } catch (error) {
      if (error instanceof IxplorerError) {
        throw error;
      }

      throw new IxplorerError({
        code: this.unavailableCode,
        message: this.unavailableMessage,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async readJson(response: Response, invalidJsonMessage: string): Promise<unknown> {
    try {
      return await response.json();
    } catch (error) {
      throw new IxplorerError({
        code: this.unavailableCode,
        message: invalidJsonMessage,
        cause: error,
      });
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
