import { isRecord } from "@shared";

/**
 * Reads the model array of an OpenAI-style listing. Accepts the standard
 * `{ data: [...] }` envelope and the bare array returned by some providers,
 * and reports an unrecognised shape as null so discovery can fail explicitly.
 */
export function openAiListEntries(body: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(body)) {
    return body.filter(isRecord);
  }

  if (isRecord(body) && Array.isArray(body.data)) {
    return body.data.filter(isRecord);
  }

  return null;
}
