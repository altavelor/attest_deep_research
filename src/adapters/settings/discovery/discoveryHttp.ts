import { ProviderHttpClient } from "@adapters/model-provider/common/http";
import type { PluginRequestLogger } from "../debugLogger";
import { ServerProfile } from "../types";
import { resolveProviderDialect } from "./providerDialects";

export interface ModelDiscoveryOptions {
  fetch?: typeof fetch;
  logger?: PluginRequestLogger;
  timeoutMs?: number;
}

/** Builds the HTTP client for discovery requests with the headers the host's dialect needs. */
export function createDiscoveryHttp(
  serverProfile: ServerProfile,
  options: ModelDiscoveryOptions,
): ProviderHttpClient {
  return new ProviderHttpClient({
    baseUrl: serverProfile.baseUrl,
    apiKey: serverProfile.apiKey,
    defaultHeaders: resolveProviderDialect(serverProfile.baseUrl).requestHeaders,
    fetch: options.fetch,
    logger: options.logger,
    timeoutMs: options.timeoutMs,
    unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
    unavailableMessage: "The model provider is unavailable.",
  });
}
