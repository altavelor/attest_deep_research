import { AttestError } from "@core/errors";
import { fetchTransportOrUnavailable } from "@shared";

export const IMAGE_SEARCH_DEFAULTS = {
  timeoutMs: 15_000,
  limit: 8,
  hardLimit: 20,
  maxResponseChars: 512_000,
} as const;

export interface ImageSourceHttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function requestImageJson(
  url: string,
  init: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    method?: "GET" | "POST";
    body?: string;
  },
  options: ImageSourceHttpOptions,
  sourceId: string,
): Promise<unknown> {
  const fetchImpl = fetchTransportOrUnavailable(options.fetch);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? IMAGE_SEARCH_DEFAULTS.timeoutMs,
  );
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", ...init.headers },
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AttestError({
        code: "WEB_SEARCH_FAILED",
        message: `${sourceId} responded with ${response.status}.`,
      });
    }
    const body = await readBoundedText(response, IMAGE_SEARCH_DEFAULTS.maxResponseChars);
    if (body === undefined) {
      throw new AttestError({
        code: "WEB_SEARCH_FAILED",
        message: `${sourceId} returned an oversized response.`,
      });
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new AttestError({
        code: "WEB_SEARCH_FAILED",
        message: `${sourceId} returned a malformed response.`,
      });
    }
  } catch (error) {
    if (error instanceof AttestError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AttestError({
      code: "WEB_SEARCH_FAILED",
      message: aborted ? `${sourceId} timed out.` : `${sourceId} request failed.`,
    });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

export function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return IMAGE_SEARCH_DEFAULTS.limit;
  return Math.max(1, Math.min(Math.floor(limit), IMAGE_SEARCH_DEFAULTS.hardLimit));
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Reads a response body while it stays inside the limit, so an oversized
 * provider reply is abandoned mid-stream instead of being buffered whole.
 * Returns undefined once the limit is passed.
 */
async function readBoundedText(response: Response, maxChars: number): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.text();
    return body.length > maxChars ? undefined : body;
  }

  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > maxChars) return undefined;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}
