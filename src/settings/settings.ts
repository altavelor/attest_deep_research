import {
  DEFAULT_FILE_VECTOR_SHARD_COUNT,
  DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
  IndexProfile,
} from "../indexing/FileVectorIndexStore";

export interface IxplorerSettings {
  chatModelProviderBaseUrl: string;
  chatModel: string;
  embeddingProviderBaseUrl: string;
  embeddingModel: string;
  lanceDbFolder: string;
  activeIndexProfileId: string;
  indexProfiles: IndexProfile[];
  includeFolders: string[];
  excludeGlobs: string[];
  duckDuckGoEnabled: boolean;
  showChatIndexControl: boolean;
  debugMode: boolean;
}

export const DEFAULT_INDEX_PROFILE_ID = "default";
export const DEFAULT_INDEX_FOLDER = ".ixplorer/index";
const DEFAULT_PROFILE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export const DEFAULT_INDEX_PROFILE: IndexProfile = {
  id: DEFAULT_INDEX_PROFILE_ID,
  name: "Default index",
  indexFolder: DEFAULT_INDEX_FOLDER,
  includeFolders: ["/"],
  excludeGlobs: [".obsidian/**", ".trash/**", ".ixplorer/**"],
  embeddingModel: "",
  embeddingProviderBaseUrl: "http://localhost:11434",
  refreshMode: "manual",
  shardCount: DEFAULT_FILE_VECTOR_SHARD_COUNT,
  keywordIndex: {
    enabled: true,
    strategy: "source-shard",
    minTokenLength: DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
  },
  createdAt: DEFAULT_PROFILE_TIMESTAMP,
  updatedAt: DEFAULT_PROFILE_TIMESTAMP,
};

export const DEFAULT_SETTINGS: IxplorerSettings = {
  chatModelProviderBaseUrl: "http://localhost:1234/v1",
  chatModel: "",
  embeddingProviderBaseUrl: DEFAULT_INDEX_PROFILE.embeddingProviderBaseUrl,
  embeddingModel: "",
  lanceDbFolder: DEFAULT_INDEX_FOLDER,
  activeIndexProfileId: DEFAULT_INDEX_PROFILE_ID,
  indexProfiles: [cloneIndexProfile(DEFAULT_INDEX_PROFILE)],
  includeFolders: [...DEFAULT_INDEX_PROFILE.includeFolders],
  excludeGlobs: [...DEFAULT_INDEX_PROFILE.excludeGlobs],
  duckDuckGoEnabled: false,
  showChatIndexControl: true,
  debugMode: false,
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
    return DEFAULT_INDEX_FOLDER;
  }

  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function migrateSettings(savedData: unknown): IxplorerSettings {
  const data = isSettingsRecord(savedData) ? savedData : {};
  const embeddingProviderBaseUrl = normalizeUrl(
    readString(data.embeddingProviderBaseUrl),
    DEFAULT_SETTINGS.embeddingProviderBaseUrl,
  );
  const embeddingModel = readString(data.embeddingModel);
  const lanceDbFolder = normalizeVaultFolder(readString(data.lanceDbFolder));
  const includeFolders = readStringList(data.includeFolders, DEFAULT_SETTINGS.includeFolders);
  const excludeGlobs = readStringList(data.excludeGlobs, DEFAULT_SETTINGS.excludeGlobs);
  const indexProfiles = readIndexProfiles(data.indexProfiles, {
    embeddingProviderBaseUrl,
    embeddingModel,
    indexFolder: lanceDbFolder,
    includeFolders,
    excludeGlobs,
  });
  const activeIndexProfileId = readActiveIndexProfileId(data.activeIndexProfileId, indexProfiles);

  return {
    chatModelProviderBaseUrl: normalizeUrl(
      readString(data.chatModelProviderBaseUrl),
      DEFAULT_SETTINGS.chatModelProviderBaseUrl,
    ),
    chatModel: readString(data.chatModel),
    embeddingProviderBaseUrl,
    embeddingModel,
    lanceDbFolder,
    activeIndexProfileId,
    indexProfiles,
    includeFolders,
    excludeGlobs,
    duckDuckGoEnabled: data.duckDuckGoEnabled === true,
    showChatIndexControl:
      typeof data.showChatIndexControl === "boolean"
        ? data.showChatIndexControl
        : DEFAULT_SETTINGS.showChatIndexControl,
    debugMode: data.debugMode === true,
  };
}

export function getActiveIndexProfile(settings: IxplorerSettings): IndexProfile {
  return (
    settings.indexProfiles.find((profile) => profile.id === settings.activeIndexProfileId) ??
    settings.indexProfiles[0] ??
    cloneIndexProfile(DEFAULT_INDEX_PROFILE)
  );
}

export function updateActiveIndexProfile(
  settings: IxplorerSettings,
  updates: Partial<
    Pick<
      IndexProfile,
      | "indexFolder"
      | "includeFolders"
      | "excludeGlobs"
      | "embeddingModel"
      | "embeddingProviderBaseUrl"
    >
  >,
): void {
  const profile = getActiveIndexProfile(settings);
  const updatedProfile: IndexProfile = {
    ...profile,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  const index = settings.indexProfiles.findIndex((candidate) => candidate.id === profile.id);

  if (index >= 0) {
    settings.indexProfiles[index] = updatedProfile;
  } else {
    settings.indexProfiles = [updatedProfile];
    settings.activeIndexProfileId = updatedProfile.id;
  }
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

function readIndexProfiles(
  value: unknown,
  legacy: Pick<
    IndexProfile,
    | "embeddingProviderBaseUrl"
    | "embeddingModel"
    | "indexFolder"
    | "includeFolders"
    | "excludeGlobs"
  >,
): IndexProfile[] {
  if (!Array.isArray(value)) {
    return [
      createIndexProfile({
        id: DEFAULT_INDEX_PROFILE_ID,
        name: "Default index",
        ...legacy,
      }),
    ];
  }

  const profiles = value
    .map((item) => normalizeIndexProfile(item))
    .filter((item): item is IndexProfile => item !== null);

  return profiles.length > 0 ? profiles : [createIndexProfile({ ...legacy })];
}

function normalizeIndexProfile(value: unknown): IndexProfile | null {
  if (!isSettingsRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  if (!id) {
    return null;
  }

  return createIndexProfile({
    id,
    name: readString(value.name) || "Index",
    indexFolder: normalizeVaultFolder(readString(value.indexFolder)),
    includeFolders: readStringList(value.includeFolders, DEFAULT_SETTINGS.includeFolders),
    excludeGlobs: readStringList(value.excludeGlobs, DEFAULT_SETTINGS.excludeGlobs),
    embeddingModel: readString(value.embeddingModel),
    embeddingProviderBaseUrl: normalizeUrl(
      readString(value.embeddingProviderBaseUrl),
      DEFAULT_SETTINGS.embeddingProviderBaseUrl,
    ),
    createdAt: readString(value.createdAt) || DEFAULT_PROFILE_TIMESTAMP,
    updatedAt: readString(value.updatedAt) || DEFAULT_PROFILE_TIMESTAMP,
  });
}

function createIndexProfile(
  values: Partial<IndexProfile> &
    Pick<
      IndexProfile,
      | "indexFolder"
      | "includeFolders"
      | "excludeGlobs"
      | "embeddingModel"
      | "embeddingProviderBaseUrl"
    >,
): IndexProfile {
  return {
    ...cloneIndexProfile(DEFAULT_INDEX_PROFILE),
    ...values,
    id: values.id ?? DEFAULT_INDEX_PROFILE_ID,
    name: values.name ?? "Default index",
    indexFolder: normalizeVaultFolder(values.indexFolder),
    includeFolders: [...values.includeFolders],
    excludeGlobs: [...values.excludeGlobs],
    shardCount: DEFAULT_FILE_VECTOR_SHARD_COUNT,
    keywordIndex: {
      enabled: true,
      strategy: "source-shard",
      minTokenLength: DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
    },
  };
}

function readActiveIndexProfileId(value: unknown, profiles: IndexProfile[]): string {
  const id = readString(value);

  if (id && profiles.some((profile) => profile.id === id)) {
    return id;
  }

  return profiles[0]?.id ?? DEFAULT_INDEX_PROFILE_ID;
}

function cloneIndexProfile(profile: IndexProfile): IndexProfile {
  return {
    ...profile,
    includeFolders: [...profile.includeFolders],
    excludeGlobs: [...profile.excludeGlobs],
    sourceKinds: profile.sourceKinds ? [...profile.sourceKinds] : undefined,
    keywordIndex: { ...profile.keywordIndex },
  };
}
