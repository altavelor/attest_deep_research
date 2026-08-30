import { WebPageFetchFailure } from "@application/ports";
import type { PluginRequestLogger } from "@adapters/settings/debugLogger";
import { fetchTransportOrUnavailable } from "@shared";

export interface FetchHttpRuntime {
  fetch?: typeof fetch;
  timeoutMs?: number;
  logger?: PluginRequestLogger;
}

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_CONTENT_CHARS = 12_000;

export interface HttpRequestSpec {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export type HttpTextResult =
  { ok: true; text: string; status: number } | { ok: false; result: WebPageFetchFailure };

export async function requestText(
  spec: HttpRequestSpec,
  runtime: FetchHttpRuntime,
  timeoutOverrideMs?: number,
): Promise<HttpTextResult> {
  const fetchImpl = fetchTransportOrUnavailable(runtime.fetch);
  const controller = new AbortController();
  const timeoutMs =
    typeof timeoutOverrideMs === "number" && timeoutOverrideMs > 0
      ? timeoutOverrideMs
      : (runtime.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const context = { url: spec.url, method: spec.method ?? "GET", headers: spec.headers ?? {} };

  try {
    runtime.logger?.logRequest(context);
    const response = await fetchImpl.call(globalThis, spec.url, {
      method: context.method,
      headers: context.headers,
      ...(spec.body !== undefined ? { body: spec.body } : {}),
      signal: controller.signal,
    });
    runtime.logger?.logResponse({
      ...context,
      status: response.status,
      statusText: response.statusText,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        result: fetchFailure(
          "web-fetch-http",
          `Fetch returned HTTP ${response.status}.`,
          response.status === 429 || response.status >= 500,
          { status: response.status },
        ),
      };
    }
    return { ok: true, text: await response.text(), status: response.status };
  } catch (error) {
    runtime.logger?.logError(error, context);
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      result: isAbort
        ? fetchFailure("web-fetch-timeout", "Page fetch timed out.", true)
        : fetchFailure("web-fetch-network", "Page fetch failed.", true),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchFailure(
  code: string,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): WebPageFetchFailure {
  return {
    ok: false,
    error: { code, message, retryable, ...(details ? { details } : {}) },
  };
}
