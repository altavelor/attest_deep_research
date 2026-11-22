import { AttestSettings } from "../types";

/**
 * Rewrites a base URL saved for a removed native API format into its
 * OpenAI-compatible endpoint. Ollama drops a trailing `/api` and gains `/v1`;
 * Anthropic replaces any trailing version segment with `/v1`.
 */
export function legacyApiFormatBaseUrl(apiFormat: "ollama" | "anthropic", baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (apiFormat === "ollama") {
    const root = trimmed.replace(/\/api$/i, "");
    return /\/v1$/i.test(root) ? root : `${root}/v1`;
  }
  return `${trimmed.replace(/\/v\d+$/i, "")}/v1`;
}

/**
 * Converts server profiles saved with the native `ollama` or `anthropic` format,
 * or with a corrupted format, to the OpenAI-compatible format. Identity, key,
 * timestamps and suspension state are kept, so the pass is idempotent.
 */
export function migrateLegacyApiFormats(settings: AttestSettings): void {
  for (const server of settings.serverProfiles) {
    const apiFormat: unknown = server.apiFormat;
    if (apiFormat === "openai-compatible") {
      continue;
    }
    if (
      (apiFormat === "ollama" || apiFormat === "anthropic") &&
      typeof server.baseUrl === "string"
    ) {
      server.baseUrl = legacyApiFormatBaseUrl(apiFormat, server.baseUrl);
    }
    server.apiFormat = "openai-compatible";
  }
}
