import {
  contextLengthFromModelMetadata,
  isOllamaTagsResponse,
  modelNamesFromOllamaTags,
} from "@adapters/model-provider/common/models";
import { DEFAULT_PROVIDER_TIMEOUT_MS } from "@adapters/model-provider/common/http";
import { scheduleTimeout } from "@shared";
import { ServerProfile } from "../types";
import { createDiscoveryHttp, ModelDiscoveryOptions } from "./discoveryHttp";

/** Maps an OpenAI-compatible `/v1` base URL to the Ollama native `/api` base URL. */
export function ollamaNativeBaseUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? `${trimmed.slice(0, -3)}/api` : undefined;
}

/**
 * Reads the model names from the Ollama native tag listing, which identifies an
 * Ollama server behind an OpenAI-compatible URL. Any failure or a response of
 * another shape yields `undefined`, so the caller keeps its own listing.
 */
export async function fetchOllamaModelNames(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions,
): Promise<Set<string> | undefined> {
  const nativeBaseUrl = ollamaNativeBaseUrl(serverProfile.baseUrl);
  if (!nativeBaseUrl) {
    return undefined;
  }

  try {
    const body = await requestOllamaJson(
      { ...serverProfile, baseUrl: nativeBaseUrl },
      "/tags",
      { method: "GET" },
      options,
    );
    return isOllamaTagsResponse(body) ? new Set(modelNamesFromOllamaTags(body)) : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a model's context length from the Ollama native `/show` endpoint, or `undefined` on any failure. */
export async function fetchOllamaContextLength(
  serverProfile: ServerProfile,
  modelName: string,
  options: ModelDiscoveryOptions,
): Promise<number | undefined> {
  const nativeBaseUrl = ollamaNativeBaseUrl(serverProfile.baseUrl);
  if (!nativeBaseUrl) {
    return undefined;
  }

  try {
    const body = await requestOllamaJson(
      { ...serverProfile, baseUrl: nativeBaseUrl },
      "/show",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: modelName }),
      },
      options,
    );
    return contextLengthFromModelMetadata(body);
  } catch {
    return undefined;
  }
}

/** Requests an Ollama native endpoint under one deadline that also covers reading the JSON body. */
async function requestOllamaJson(
  nativeProfile: ServerProfile,
  path: string,
  init: RequestInit,
  options: ModelDiscoveryOptions,
): Promise<unknown> {
  const deadline = new AbortController();
  const timer = scheduleTimeout(
    () => deadline.abort(new DOMException("The Ollama request timed out.", "TimeoutError")),
    options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
  );
  try {
    const http = createDiscoveryHttp(nativeProfile, options);
    const response = await http.request(path, { ...init, signal: deadline.signal });
    return await http.readJson(response, "Ollama returned invalid JSON.", deadline.signal);
  } finally {
    timer.cancel();
  }
}
