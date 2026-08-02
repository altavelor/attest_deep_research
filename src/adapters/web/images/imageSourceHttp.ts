// Shared HTTP plumbing for image providers: bounded JSON requests with a
// timeout, plus small helpers for reading untrusted provider payloads.

import { IxplorerError } from "@core/errors";

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
  init: { headers?: Record<string, string>; signal?: AbortSignal },
  options: ImageSourceHttpOptions,
  sourceId: string,
): Promise<unknown> {
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? IMAGE_SEARCH_DEFAULTS.timeoutMs,
  );
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new IxplorerError("web-search-failed", `${sourceId} responded with ${response.status}.`);
    }
    const body = await response.text();
    if (body.length > IMAGE_SEARCH_DEFAULTS.maxResponseChars) {
      throw new IxplorerError("web-search-failed", `${sourceId} returned an oversized response.`);
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new IxplorerError("web-search-failed", `${sourceId} returned a malformed response.`);
    }
  } catch (error) {
    if (error instanceof IxplorerError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new IxplorerError(
      "web-search-failed",
      aborted ? `${sourceId} timed out.` : `${sourceId} request failed.`,
    );
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
