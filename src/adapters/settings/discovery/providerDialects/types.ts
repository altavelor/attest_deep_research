import { ModelCapability } from "../../types";

export interface ProviderModelKinds {
  chat: boolean;
  embeddings: boolean;
}

export interface ProviderDialect {
  readonly id: string;
  readonly label: string;
  readonly hosts: readonly string[];
  readonly modelListPaths: readonly string[];
  extractEntries(body: unknown): Record<string, unknown>[] | null;
  detectKinds(entry: Record<string, unknown>): ProviderModelKinds;
}

export function modelIdFrom(entry: Record<string, unknown>): string | undefined {
  for (const key of ["id", "name", "model"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim())
    : [];
}

export function includesToken(values: string[], token: string): boolean {
  return values.some((value) => value.toLocaleLowerCase().includes(token));
}

export function looksLikeEmbeddingId(id: string): boolean {
  return /embed|embedding/i.test(id);
}

export function capabilityFromKinds(kinds: ProviderModelKinds): ModelCapability {
  return {
    chat: kinds.chat,
    embeddings: kinds.embeddings,
    temperature: kinds.chat,
    maxTokens: kinds.chat,
    detectionSource: "format-default",
  };
}
