export interface IxplorerSettings {
  chatModelProviderBaseUrl: string;
  chatModel: string;
  embeddingProviderBaseUrl: string;
  embeddingModel: string;
  lanceDbFolder: string;
  includeFolders: string[];
  excludeGlobs: string[];
  duckDuckGoEnabled: boolean;
}

export const DEFAULT_SETTINGS: IxplorerSettings = {
  chatModelProviderBaseUrl: "http://localhost:1234/v1",
  chatModel: "",
  embeddingProviderBaseUrl: "http://localhost:11434",
  embeddingModel: "",
  lanceDbFolder: ".ixplorer/index",
  includeFolders: ["/"],
  excludeGlobs: [".obsidian/**", ".trash/**", ".ixplorer/**"],
  duckDuckGoEnabled: false,
};

export function normalizeListInput(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatListInput(value: string[]): string {
  return value.join("\n");
}

export function normalizeUrl(value: string, fallback: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed.replace(/\/+$/, "");
}

export function normalizeVaultFolder(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return DEFAULT_SETTINGS.lanceDbFolder;
  }

  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function migrateSettings(savedData: unknown): IxplorerSettings {
  const data = isSettingsRecord(savedData) ? savedData : {};

  return {
    chatModelProviderBaseUrl: normalizeUrl(
      readString(data.chatModelProviderBaseUrl),
      DEFAULT_SETTINGS.chatModelProviderBaseUrl,
    ),
    chatModel: readString(data.chatModel),
    embeddingProviderBaseUrl: normalizeUrl(
      readString(data.embeddingProviderBaseUrl),
      DEFAULT_SETTINGS.embeddingProviderBaseUrl,
    ),
    embeddingModel: readString(data.embeddingModel),
    lanceDbFolder: normalizeVaultFolder(readString(data.lanceDbFolder)),
    includeFolders: readStringList(data.includeFolders, DEFAULT_SETTINGS.includeFolders),
    excludeGlobs: readStringList(data.excludeGlobs, DEFAULT_SETTINGS.excludeGlobs),
    duckDuckGoEnabled: data.duckDuckGoEnabled === true,
  };
}

function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim());

  return items.length > 0 ? items.filter(Boolean) : [...fallback];
}
