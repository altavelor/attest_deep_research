import { DEFAULT_CHUNK_LENGTH, DEFAULT_CHUNK_OVERLAP } from "../extractors/common";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_FILE_VECTOR_SHARD_COUNT,
  DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
  DEFAULT_PDF_CHUNK_OVERLAP,
  DEFAULT_PDF_CHUNK_SIZE,
  IndexProfile,
} from "../indexing/FileVectorIndexStore";
import { ApiFormat, ChatApiProtocol } from "../shared/types";
import { isRecord } from "../shared/guards";
import { isNonNegativeInteger, isPositiveInteger } from "../shared/numbers";
import {
  INDEX_DESCRIPTION_MAX_CHARACTERS,
  type IndexDescription,
} from "../indexing/IndexDescription";
import {
  normalizeToolCapabilitySettings,
  resolveToolCapabilities,
  ToolCapabilitySettings,
} from "./toolCapabilities";
import { ModelCapabilitySnapshot, readModelCapabilityCache } from "./modelCapabilityCache";

export interface ServerProfile {
  id: string;
  name: string;
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey?: string;
  isSuspended?: boolean;
  suspendedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelCapability {
  chat: boolean;
  embeddings: boolean;
  vision?: boolean;
  tools?: boolean;
  toolCalling?: ToolCapabilitySettings;
  temperature?: boolean;
  maxTokens?: boolean;
  contextLength?: number;
  maxOutputTokens?: number;
  reasoningObservation?: {
    chatCompletions: boolean;
    responses: boolean;
    dialects: string[];
    source: "passive-observation" | "metadata";
    checkedAt: string;
  };
  detectionSource: "metadata" | "probe" | "format-default";
}

export interface ChatModelProfile {
  id: string;
  name: string;
  serverProfileId: string;
  modelName: string;
  toolsEnabled: boolean;
  noteMutationAccess: boolean;
  reasoning: ReasoningProfileSettings;
  reasoningCapabilities?: ReasoningCapabilitySettings;
  temperature?: number;
  maxTokens?: number;
  capabilities?: ModelCapability;
  isSuspended?: boolean;
  suspendedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReasoningProfileSettings {
  mode: "off" | "auto" | "on";
  effort?: string;
  summary: "off" | "auto";
}

export interface ReasoningCapabilitySettings {
  source: "metadata" | "probe" | "manual";
  responses: boolean;
  continuation: boolean;
  summary: boolean;
  efforts: string[];
  requiresEffort?: boolean;
  defaultEffort?: string;
  failureReason?: string;
  checkedAt?: string;
  cacheKey?: string;
  contractVersion?: number;
}

export interface EmbeddingModelProfile {
  id: string;
  name: string;
  serverProfileId: string;
  modelName: string;
  capabilities?: ModelCapability;
  isSuspended?: boolean;
  suspendedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IxplorerSettings {
  serverProfiles: ServerProfile[];
  chatModelProfiles: ChatModelProfile[];
  embeddingModelProfiles: EmbeddingModelProfile[];
  activeChatModelProfileId: string;
  activeEmbeddingModelProfileId: string;
  lanceDbFolder: string;
  activeIndexProfileId: string;
  indexProfiles: IndexProfile[];
  includeFolders: string[];
  excludeGlobs: string[];
  duckDuckGoEnabled: boolean;
  showChatIndexControl: boolean;
  includeActiveFileContext: boolean;
  useLinkedNotes: boolean;
  includeBacklinks: boolean;
  expandFilteredContextThroughLinks: boolean;
  graphContextDepth: number;
  useWebWhenFreshnessNeeded: boolean;
  forceEagerResearch: boolean;
  debugMode: boolean;
  modelCapabilityCache: Record<string, ModelCapabilitySnapshot>;
}

export const DEFAULT_INDEX_PROFILE_ID = "default";
export const DEFAULT_INDEX_FOLDER = ".ixplorer/index";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096;
export const MAX_INDEX_PROFILE_COUNT = 30;
export const MAX_PROFILE_NAME_LENGTH = 30;
const DEFAULT_PROFILE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const INDEX_PROFILE_NAME_PATTERN = /^[\p{L}\p{N} _.\-()[\]]+$/u;

export const DEFAULT_INDEX_PROFILE: IndexProfile = {
  id: DEFAULT_INDEX_PROFILE_ID,
  name: "Default index",
  mode: "wholeVault",
  indexFolder: DEFAULT_INDEX_FOLDER,
  includeFolders: ["/"],
  excludeGlobs: [".obsidian/**", ".trash/**", ".ixplorer/**"],
  embeddingModelProfileId: "",
  isSuspended: true,
  suspendedReason: "Select an embedding model profile.",
  refreshMode: "manual",
  shardCount: DEFAULT_FILE_VECTOR_SHARD_COUNT,
  chunkSize: DEFAULT_CHUNK_LENGTH,
  chunkOverlap: DEFAULT_CHUNK_OVERLAP,
  pdfChunkSize: DEFAULT_PDF_CHUNK_SIZE,
  pdfChunkOverlap: DEFAULT_PDF_CHUNK_OVERLAP,
  embeddingBatchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
  keywordIndex: {
    enabled: true,
    strategy: "source-shard",
    minTokenLength: DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
  },
  createdAt: DEFAULT_PROFILE_TIMESTAMP,
  updatedAt: DEFAULT_PROFILE_TIMESTAMP,
};

export const DEFAULT_SETTINGS: IxplorerSettings = {
  serverProfiles: [],
  chatModelProfiles: [],
  embeddingModelProfiles: [],
  activeChatModelProfileId: "",
  activeEmbeddingModelProfileId: "",
  lanceDbFolder: DEFAULT_INDEX_FOLDER,
  activeIndexProfileId: DEFAULT_INDEX_PROFILE_ID,
  indexProfiles: [cloneIndexProfile(DEFAULT_INDEX_PROFILE)],
  includeFolders: [...DEFAULT_INDEX_PROFILE.includeFolders],
  excludeGlobs: [...DEFAULT_INDEX_PROFILE.excludeGlobs],
  duckDuckGoEnabled: false,
  showChatIndexControl: true,
  includeActiveFileContext: true,
  useLinkedNotes: true,
  includeBacklinks: true,
  expandFilteredContextThroughLinks: false,
  graphContextDepth: 1,
  useWebWhenFreshnessNeeded: true,
  forceEagerResearch: false,
  debugMode: false,
  modelCapabilityCache: {},
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
  const lanceDbFolder = normalizeVaultFolder(readString(data.lanceDbFolder));
  const includeFolders = readStringList(data.includeFolders, DEFAULT_SETTINGS.includeFolders);
  const excludeGlobs = readStringList(data.excludeGlobs, DEFAULT_SETTINGS.excludeGlobs);
  const settings: IxplorerSettings = {
    serverProfiles: readServerProfiles(data.serverProfiles),
    chatModelProfiles: readChatModelProfiles(data.chatModelProfiles),
    embeddingModelProfiles: readEmbeddingModelProfiles(data.embeddingModelProfiles),
    activeChatModelProfileId: readString(data.activeChatModelProfileId),
    activeEmbeddingModelProfileId: readString(data.activeEmbeddingModelProfileId),
    lanceDbFolder,
    activeIndexProfileId: readString(data.activeIndexProfileId),
    indexProfiles: readIndexProfiles(data.indexProfiles, {
      indexFolder: lanceDbFolder,
      includeFolders,
      excludeGlobs,
    }),
    includeFolders,
    excludeGlobs,
    duckDuckGoEnabled: data.duckDuckGoEnabled === true,
    showChatIndexControl:
      typeof data.showChatIndexControl === "boolean"
        ? data.showChatIndexControl
        : DEFAULT_SETTINGS.showChatIndexControl,
    includeActiveFileContext:
      typeof data.includeActiveFileContext === "boolean"
        ? data.includeActiveFileContext
        : DEFAULT_SETTINGS.includeActiveFileContext,
    useLinkedNotes:
      typeof data.useLinkedNotes === "boolean"
        ? data.useLinkedNotes
        : DEFAULT_SETTINGS.useLinkedNotes,
    includeBacklinks:
      typeof data.includeBacklinks === "boolean"
        ? data.includeBacklinks
        : DEFAULT_SETTINGS.includeBacklinks,
    expandFilteredContextThroughLinks:
      typeof data.expandFilteredContextThroughLinks === "boolean"
        ? data.expandFilteredContextThroughLinks
        : DEFAULT_SETTINGS.expandFilteredContextThroughLinks,
    graphContextDepth: readGraphContextDepth(data.graphContextDepth),
    useWebWhenFreshnessNeeded:
      typeof data.useWebWhenFreshnessNeeded === "boolean"
        ? data.useWebWhenFreshnessNeeded
        : DEFAULT_SETTINGS.useWebWhenFreshnessNeeded,
    forceEagerResearch:
      typeof data.forceEagerResearch === "boolean"
        ? data.forceEagerResearch
        : DEFAULT_SETTINGS.forceEagerResearch,
    debugMode: data.debugMode === true,
    modelCapabilityCache: readModelCapabilityCache(data.modelCapabilityCache),
  };

  settings.activeIndexProfileId = readActiveIndexProfileId(
    settings.activeIndexProfileId,
    settings.indexProfiles,
  );
  normalizeSettingsState(settings);
  return settings;
}

export function normalizeSettingsState(settings: IxplorerSettings): void {
  markInvalidProfilesSuspended(settings);
  normalizeActiveChatModel(settings);
  normalizeActiveEmbeddingModel(settings);
  normalizeIndexProfiles(settings);
  normalizeActiveIndexProfile(settings);
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
      | "embeddingModelProfileId"
      | "chunkSize"
      | "chunkOverlap"
      | "pdfChunkSize"
      | "pdfChunkOverlap"
      | "embeddingBatchSize"
    >
  >,
): void {
  const profile = getActiveIndexProfile(settings);
  const updatedProfile: IndexProfile = {
    ...profile,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  normalizeIndexProfileNumbers(updatedProfile);
  const index = settings.indexProfiles.findIndex((candidate) => candidate.id === profile.id);

  if (index >= 0) {
    settings.indexProfiles[index] = updatedProfile;
  } else {
    settings.indexProfiles = [updatedProfile];
    settings.activeIndexProfileId = updatedProfile.id;
  }

  normalizeSettingsState(settings);
}

export function isValidIndexProfileName(value: string): boolean {
  const normalized = normalizeProfileName(value);
  return (
    normalized.length > 0 &&
    normalized.length <= MAX_PROFILE_NAME_LENGTH &&
    INDEX_PROFILE_NAME_PATTERN.test(normalized)
  );
}

export function isValidProfileName(value: string): boolean {
  const normalized = normalizeProfileName(value);
  return normalized.length > 0 && normalized.length <= MAX_PROFILE_NAME_LENGTH;
}

export function getActiveChatModelProfile(
  settings: IxplorerSettings,
): ChatModelProfile | undefined {
  return settings.chatModelProfiles.find(
    (profile) => profile.id === settings.activeChatModelProfileId && !isProfileSuspended(profile),
  );
}

export function resolveChatModelProfile(
  settings: IxplorerSettings,
  profileId: string | undefined,
): ChatModelProfile | undefined {
  const requested = profileId
    ? settings.chatModelProfiles.find((profile) => profile.id === profileId)
    : undefined;

  if (requested && !isProfileSuspended(requested)) {
    return requested;
  }

  return getActiveChatModelProfile(settings) ?? settings.chatModelProfiles.find(isProfileActive);
}

export function resolveEmbeddingModelProfile(
  settings: IxplorerSettings,
  profileId: string | undefined,
): EmbeddingModelProfile | undefined {
  return settings.embeddingModelProfiles.find(
    (profile) => profile.id === profileId && !isProfileSuspended(profile),
  );
}

export function resolveServerProfile(
  settings: IxplorerSettings,
  profileId: string | undefined,
): ServerProfile | undefined {
  return settings.serverProfiles.find(
    (profile) => profile.id === profileId && !isProfileSuspended(profile),
  );
}

export function canDeleteServerProfile(
  settings: IxplorerSettings,
  serverProfileId: string,
): boolean {
  return (
    !settings.chatModelProfiles.some((profile) => profile.serverProfileId === serverProfileId) &&
    !settings.embeddingModelProfiles.some((profile) => profile.serverProfileId === serverProfileId)
  );
}

export function canDeleteEmbeddingModelProfile(
  settings: IxplorerSettings,
  embeddingModelProfileId: string,
): boolean {
  return !settings.indexProfiles.some(
    (profile) => profile.embeddingModelProfileId === embeddingModelProfileId,
  );
}

export function hasDuplicateProfileName<T extends { id: string; name: string }>(
  profiles: T[],
  name: string,
  currentId?: string,
): boolean {
  const normalized = normalizeProfileName(name).toLocaleLowerCase();
  return profiles.some(
    (profile) => profile.id !== currentId && profile.name.toLocaleLowerCase() === normalized,
  );
}

export function isProfileSuspended(profile: { isSuspended?: boolean }): boolean {
  return profile.isSuspended === true;
}

export function isIndexProfileSelectable(
  profile: Pick<IndexProfile, "isSuspended" | "lastIndexedAt">,
): boolean {
  return !isProfileSuspended(profile) && Boolean(profile.lastIndexedAt);
}

export function createProfileId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function markInvalidProfilesSuspended(settings: IxplorerSettings): void {
  for (const server of settings.serverProfiles) {
    server.isSuspended = server.isSuspended === true;
    server.suspendedReason = server.isSuspended
      ? server.suspendedReason || "Server profile is suspended."
      : undefined;
  }

  for (const profile of settings.chatModelProfiles) {
    const server = settings.serverProfiles.find(
      (candidate) => candidate.id === profile.serverProfileId,
    );
    if (!server) {
      suspend(profile, "Server profile was deleted.");
    } else if (isProfileSuspended(server)) {
      suspend(profile, "Server profile is suspended.");
    } else {
      if (server.apiFormat !== "openai-compatible") {
        profile.reasoning = { mode: "off", summary: "off" };
        profile.reasoningCapabilities = undefined;
      }
      unsuspend(profile);
    }
  }

  for (const profile of settings.embeddingModelProfiles) {
    const server = settings.serverProfiles.find(
      (candidate) => candidate.id === profile.serverProfileId,
    );
    if (!server) {
      suspend(profile, "Server profile was deleted.");
    } else if (isProfileSuspended(server)) {
      suspend(profile, "Server profile is suspended.");
    } else {
      unsuspend(profile);
    }
  }
}

function normalizeActiveChatModel(settings: IxplorerSettings): void {
  if (
    settings.activeChatModelProfileId &&
    settings.chatModelProfiles.some(
      (profile) => profile.id === settings.activeChatModelProfileId && !isProfileSuspended(profile),
    )
  ) {
    return;
  }

  settings.activeChatModelProfileId = settings.chatModelProfiles.find(isProfileActive)?.id ?? "";
}

function normalizeActiveEmbeddingModel(settings: IxplorerSettings): void {
  if (
    settings.activeEmbeddingModelProfileId &&
    !settings.embeddingModelProfiles.some(
      (profile) =>
        profile.id === settings.activeEmbeddingModelProfileId && !isProfileSuspended(profile),
    )
  ) {
    settings.activeEmbeddingModelProfileId = "";
  }
}

function normalizeIndexProfiles(settings: IxplorerSettings): void {
  for (const profile of settings.indexProfiles) {
    normalizeIndexProfileNumbers(profile);
    const embedding = profile.embeddingModelProfileId
      ? settings.embeddingModelProfiles.find(
        (candidate) => candidate.id === profile.embeddingModelProfileId,
      )
      : undefined;

    if (!embedding) {
      suspend(profile, "Select an embedding model profile.");
    } else if (isProfileSuspended(embedding)) {
      suspend(profile, "Embedding model profile is suspended.");
    } else {
      unsuspend(profile);
    }
  }
}

function isProfileActive<T extends { isSuspended?: boolean }>(profile: T): boolean {
  return !isProfileSuspended(profile);
}

function suspend(
  profile: { isSuspended?: boolean; suspendedReason?: string },
  reason: string,
): void {
  profile.isSuspended = true;
  profile.suspendedReason = reason;
}

function unsuspend(profile: { isSuspended?: boolean; suspendedReason?: string }): void {
  profile.isSuspended = false;
  profile.suspendedReason = undefined;
}

function readServerProfiles(value: unknown): ServerProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeServerProfile)
    .filter((profile): profile is ServerProfile => profile !== null);
}

function normalizeServerProfile(value: unknown): ServerProfile | null {
  if (!isSettingsRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const name = normalizeProfileName(readString(value.name));
  const apiFormat = readApiFormat(value.apiFormat);
  const baseUrl = normalizeUrl(readString(value.baseUrl), "");

  if (!id || !name || !apiFormat || !baseUrl) {
    return null;
  }

  return {
    id,
    name,
    apiFormat,
    baseUrl,
    ...(readString(value.apiKey) ? { apiKey: readString(value.apiKey) } : {}),
    isSuspended: value.isSuspended === true,
    suspendedReason: readString(value.suspendedReason) || undefined,
    createdAt: readString(value.createdAt) || DEFAULT_PROFILE_TIMESTAMP,
    updatedAt: readString(value.updatedAt) || DEFAULT_PROFILE_TIMESTAMP,
  };
}

function readChatModelProfiles(value: unknown): ChatModelProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeChatModelProfile)
    .filter((profile): profile is ChatModelProfile => profile !== null);
}

function normalizeChatModelProfile(value: unknown): ChatModelProfile | null {
  if (!isSettingsRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const name = normalizeProfileName(readString(value.name));
  const serverProfileId = readString(value.serverProfileId);
  const modelName = readString(value.modelName);

  if (!id || !name || !serverProfileId || !modelName) {
    return null;
  }

  const toolsEnabled = value.toolsEnabled !== false;

  return {
    id,
    name,
    serverProfileId,
    modelName,
    toolsEnabled,
    // Note mutation access mirrors the Tools toggle: there is no separate UI
    // control, so it is fully derived from whether tools are enabled.
    noteMutationAccess: toolsEnabled,
    reasoning: readReasoningProfileSettings(value.reasoning),
    reasoningCapabilities: readReasoningCapabilitySettings(value.reasoningCapabilities),
    temperature: readOptionalNumber(value.temperature),
    maxTokens: readOptionalPositiveInteger(value.maxTokens),
    capabilities: normalizeCapability(value.capabilities),
    isSuspended: value.isSuspended === true,
    suspendedReason: readString(value.suspendedReason) || undefined,
    createdAt: readString(value.createdAt) || DEFAULT_PROFILE_TIMESTAMP,
    updatedAt: readString(value.updatedAt) || DEFAULT_PROFILE_TIMESTAMP,
  };
}

function readReasoningProfileSettings(value: unknown): ReasoningProfileSettings {
  const record = isSettingsRecord(value) ? value : {};
  const effort = readString(record.effort);
  const mode =
    record.mode === "off" || record.mode === "auto" || record.mode === "on"
      ? record.mode
      : record.enabled === true
        ? "on"
        : "off";
  return {
    mode,
    ...(effort ? { effort } : {}),
    summary: record.summary === "auto" ? "auto" : "off",
  };
}

export function resolveEffectiveChatApiProtocol(
  profile: Pick<ChatModelProfile, "reasoning" | "reasoningCapabilities">,
): ChatApiProtocol {
  return profile.reasoning.mode !== "off" &&
    profile.reasoningCapabilities?.responses === true &&
    profile.reasoningCapabilities.continuation === true
    ? "responses"
    : "chat-completions";
}

export function resolveEffectiveTools(
  profile: Pick<ChatModelProfile, "toolsEnabled" | "capabilities">,
): boolean {
  return (
    profile.toolsEnabled &&
    resolveToolCapabilities(profile.capabilities?.toolCalling).capabilities.calls
  );
}

export function resolveEffectiveReasoning(
  profile: Pick<ChatModelProfile, "reasoning" | "reasoningCapabilities">,
  protocol: ChatApiProtocol,
): { enabled: boolean; effort?: string; summary: "off" | "auto" } {
  const enabled = profile.reasoning.mode !== "off";
  if (!enabled) return { enabled: false, summary: "off" };
  const effort =
    protocol === "responses"
      ? (profile.reasoning.effort ?? profile.reasoningCapabilities?.defaultEffort)
      : undefined;
  return {
    enabled: true,
    ...(effort ? { effort } : {}),
    summary:
      protocol === "responses" &&
        profile.reasoning.summary === "auto" &&
        profile.reasoningCapabilities?.summary === true
        ? "auto"
        : "off",
  };
}

function readReasoningCapabilitySettings(value: unknown): ReasoningCapabilitySettings | undefined {
  if (!isSettingsRecord(value)) return undefined;
  const source =
    value.source === "metadata" || value.source === "probe" || value.source === "manual"
      ? value.source
      : undefined;
  if (!source) return undefined;
  const efforts = Array.isArray(value.efforts)
    ? [
      ...new Set(
        value.efforts
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ]
    : [];
  const defaultEffort = readString(value.defaultEffort);
  const failureReason = readString(value.failureReason).slice(0, 500);
  return {
    source,
    responses: value.responses === true,
    continuation: value.continuation === true,
    summary: value.summary === true,
    efforts,
    ...(value.requiresEffort === true ? { requiresEffort: true } : {}),
    ...(defaultEffort && efforts.includes(defaultEffort) ? { defaultEffort } : {}),
    ...(failureReason ? { failureReason } : {}),
    ...(readString(value.checkedAt) ? { checkedAt: readString(value.checkedAt) } : {}),
    ...(readString(value.cacheKey) ? { cacheKey: readString(value.cacheKey) } : {}),
    ...(isPositiveInteger(value.contractVersion) ? { contractVersion: value.contractVersion } : {}),
  };
}

function readEmbeddingModelProfiles(value: unknown): EmbeddingModelProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeEmbeddingModelProfile)
    .filter((profile): profile is EmbeddingModelProfile => profile !== null);
}

function normalizeEmbeddingModelProfile(value: unknown): EmbeddingModelProfile | null {
  if (!isSettingsRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const name = normalizeProfileName(readString(value.name));
  const serverProfileId = readString(value.serverProfileId);
  const modelName = readString(value.modelName);

  if (!id || !name || !serverProfileId || !modelName) {
    return null;
  }

  return {
    id,
    name,
    serverProfileId,
    modelName,
    capabilities: normalizeCapability(value.capabilities),
    isSuspended: value.isSuspended === true,
    suspendedReason: readString(value.suspendedReason) || undefined,
    createdAt: readString(value.createdAt) || DEFAULT_PROFILE_TIMESTAMP,
    updatedAt: readString(value.updatedAt) || DEFAULT_PROFILE_TIMESTAMP,
  };
}

function normalizeCapability(value: unknown): ModelCapability | undefined {
  if (
    !isSettingsRecord(value) ||
    typeof value.chat !== "boolean" ||
    typeof value.embeddings !== "boolean"
  ) {
    return undefined;
  }

  const detectionSource =
    value.detectionSource === "metadata" ||
      value.detectionSource === "probe" ||
      value.detectionSource === "format-default"
      ? value.detectionSource
      : "format-default";

  return {
    chat: value.chat,
    embeddings: value.embeddings,
    vision: typeof value.vision === "boolean" ? value.vision : undefined,
    tools: typeof value.tools === "boolean" ? value.tools : undefined,
    toolCalling: normalizeToolCapabilitySettings(
      value.toolCalling,
      typeof value.tools === "boolean" ? value.tools : undefined,
      detectionSource,
    ),
    temperature: typeof value.temperature === "boolean" ? value.temperature : undefined,
    maxTokens: typeof value.maxTokens === "boolean" ? value.maxTokens : undefined,
    contextLength: isPositiveInteger(value.contextLength) ? value.contextLength : undefined,
    maxOutputTokens: isPositiveInteger(value.maxOutputTokens) ? value.maxOutputTokens : undefined,
    reasoningObservation: normalizeReasoningObservation(value.reasoningObservation),
    detectionSource,
  };
}

function normalizeReasoningObservation(value: unknown): ModelCapability["reasoningObservation"] {
  if (!isSettingsRecord(value)) return undefined;
  const dialects = Array.isArray(value.dialects)
    ? value.dialects.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
  if (value.source !== "passive-observation" && value.source !== "metadata") return undefined;
  return {
    chatCompletions: value.chatCompletions === true,
    responses: value.responses === true,
    dialects,
    source: value.source,
    checkedAt: readString(value.checkedAt) || DEFAULT_PROFILE_TIMESTAMP,
  };
}

function readIndexProfiles(
  value: unknown,
  fallback: Pick<IndexProfile, "indexFolder" | "includeFolders" | "excludeGlobs">,
): IndexProfile[] {
  if (!Array.isArray(value)) {
    return [
      createIndexProfile({ id: DEFAULT_INDEX_PROFILE_ID, name: "Default index", ...fallback }),
    ];
  }

  const profiles = value
    .slice(0, MAX_INDEX_PROFILE_COUNT)
    .map((item) => normalizeIndexProfile(item))
    .filter((item): item is IndexProfile => item !== null);

  return profiles.length > 0 ? profiles : [createIndexProfile({ ...fallback })];
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
    mode: readIndexMode(value.mode),
    indexFolder: normalizeVaultFolder(readString(value.indexFolder)),
    includeFolders: readStringList(value.includeFolders, DEFAULT_SETTINGS.includeFolders),
    excludeGlobs: readStringList(value.excludeGlobs, DEFAULT_SETTINGS.excludeGlobs),
    embeddingModelProfileId: readString(value.embeddingModelProfileId),
    lastIndexedAt: readString(value.lastIndexedAt) || undefined,
    indexedFileCount: readNonNegativeIntegerOrUndefined(value.indexedFileCount),
    indexSizeBytes: readNonNegativeIntegerOrUndefined(value.indexSizeBytes),
    indexDescription: readIndexDescription(value.indexDescription),
    chunkSize: readPositiveInteger(value.chunkSize, DEFAULT_CHUNK_LENGTH),
    chunkOverlap: normalizeChunkOverlap(
      readNonNegativeInteger(value.chunkOverlap, DEFAULT_CHUNK_OVERLAP),
      readPositiveInteger(value.chunkSize, DEFAULT_CHUNK_LENGTH),
    ),
    pdfChunkSize: readPositiveInteger(value.pdfChunkSize, DEFAULT_PDF_CHUNK_SIZE),
    pdfChunkOverlap: normalizeChunkOverlap(
      readNonNegativeInteger(value.pdfChunkOverlap, DEFAULT_PDF_CHUNK_OVERLAP),
      readPositiveInteger(value.pdfChunkSize, DEFAULT_PDF_CHUNK_SIZE),
    ),
    embeddingBatchSize: readPositiveInteger(value.embeddingBatchSize, DEFAULT_EMBEDDING_BATCH_SIZE),
    createdAt: readString(value.createdAt) || DEFAULT_PROFILE_TIMESTAMP,
    updatedAt: readString(value.updatedAt) || DEFAULT_PROFILE_TIMESTAMP,
  });
}

export function createIndexProfile(
  values: Partial<IndexProfile> &
    Pick<IndexProfile, "indexFolder" | "includeFolders" | "excludeGlobs">,
): IndexProfile {
  const profile: IndexProfile = {
    ...cloneIndexProfile(DEFAULT_INDEX_PROFILE),
    ...values,
    id: values.id ?? DEFAULT_INDEX_PROFILE_ID,
    name: values.name ?? "Default index",
    mode: values.mode ?? "wholeVault",
    indexFolder: normalizeVaultFolder(values.indexFolder),
    includeFolders: [...values.includeFolders],
    excludeGlobs: [...values.excludeGlobs],
    embeddingModelProfileId: values.embeddingModelProfileId ?? "",
    shardCount: DEFAULT_FILE_VECTOR_SHARD_COUNT,
    keywordIndex: {
      enabled: true,
      strategy: "source-shard",
      minTokenLength: DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
    },
  };
  normalizeIndexProfileNumbers(profile);
  return profile;
}

function normalizeActiveIndexProfile(settings: IxplorerSettings): void {
  const active = settings.indexProfiles.find(
    (profile) => profile.id === settings.activeIndexProfileId,
  );

  if (active && isIndexProfileSelectable(active)) {
    return;
  }

  settings.activeIndexProfileId =
    settings.indexProfiles.find(isIndexProfileSelectable)?.id ??
    settings.indexProfiles.find(isProfileActive)?.id ??
    settings.indexProfiles[0]?.id ??
    DEFAULT_INDEX_PROFILE_ID;
}

function normalizeIndexProfileNumbers(profile: IndexProfile): void {
  const chunkSize = readPositiveInteger(profile.chunkSize, DEFAULT_CHUNK_LENGTH);
  profile.chunkSize = chunkSize;
  profile.chunkOverlap = normalizeChunkOverlap(
    readNonNegativeInteger(profile.chunkOverlap, DEFAULT_CHUNK_OVERLAP),
    chunkSize,
  );
  const pdfChunkSize = readPositiveInteger(profile.pdfChunkSize, DEFAULT_PDF_CHUNK_SIZE);
  profile.pdfChunkSize = pdfChunkSize;
  profile.pdfChunkOverlap = normalizeChunkOverlap(
    readNonNegativeInteger(profile.pdfChunkOverlap, DEFAULT_PDF_CHUNK_OVERLAP),
    pdfChunkSize,
  );
  profile.embeddingBatchSize = readPositiveInteger(
    profile.embeddingBatchSize,
    DEFAULT_EMBEDDING_BATCH_SIZE,
  );
}

function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProfileName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function readStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : [...fallback];
}

function readApiFormat(value: unknown): ApiFormat | null {
  return value === "openai-compatible" || value === "ollama" || value === "anthropic"
    ? value
    : null;
}

function readActiveIndexProfileId(value: unknown, profiles: IndexProfile[]): string {
  const id = readString(value);

  if (id && profiles.some((profile) => profile.id === id)) {
    return id;
  }

  return profiles[0]?.id ?? DEFAULT_INDEX_PROFILE_ID;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  return isPositiveInteger(value) ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  return isNonNegativeInteger(value) ? value : fallback;
}

function readNonNegativeIntegerOrUndefined(value: unknown): number | undefined {
  return isNonNegativeInteger(value) ? value : undefined;
}

function readGraphContextDepth(value: unknown): number {
  return value === 2 ? 2 : DEFAULT_SETTINGS.graphContextDepth;
}

function readIndexDescription(value: unknown): IndexDescription | undefined {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    value.text.length === 0 ||
    value.text.length > INDEX_DESCRIPTION_MAX_CHARACTERS ||
    typeof value.generatedAt !== "string" ||
    typeof value.indexUpdatedAt !== "string" ||
    value.generator !== "deterministic" ||
    !isPositiveInteger(value.algorithmVersion) ||
    (value.status !== "current" && value.status !== "stale" && value.status !== "failed") ||
    !isNonNegativeInteger(value.sourceCount) ||
    !isNonNegativeInteger(value.chunkCount) ||
    !isRecord(value.diagnostics) ||
    !isNonNegativeInteger(value.diagnostics.representativeChunkCount) ||
    typeof value.diagnostics.truncated !== "boolean" ||
    typeof value.diagnostics.usedFallback !== "boolean" ||
    (value.diagnostics.failureReason !== undefined &&
      typeof value.diagnostics.failureReason !== "string")
  ) {
    return undefined;
  }

  return {
    text: value.text,
    generatedAt: value.generatedAt,
    indexUpdatedAt: value.indexUpdatedAt,
    generator: "deterministic",
    algorithmVersion: value.algorithmVersion,
    status: value.status,
    sourceCount: value.sourceCount,
    chunkCount: value.chunkCount,
    diagnostics: {
      representativeChunkCount: value.diagnostics.representativeChunkCount,
      truncated: value.diagnostics.truncated,
      usedFallback: value.diagnostics.usedFallback,
      ...(typeof value.diagnostics.failureReason === "string"
        ? { failureReason: value.diagnostics.failureReason }
        : {}),
    },
  };
}

function readIndexMode(value: unknown): IndexProfile["mode"] {
  return value === "selected" ? "selected" : "wholeVault";
}

function normalizeChunkOverlap(value: number, chunkSize: number): number {
  return Math.max(0, Math.min(value, chunkSize - 1));
}

function cloneIndexProfile(profile: IndexProfile): IndexProfile {
  return {
    ...profile,
    includeFolders: [...profile.includeFolders],
    excludeGlobs: [...profile.excludeGlobs],
    sourceKinds: profile.sourceKinds ? [...profile.sourceKinds] : undefined,
    indexDescription: profile.indexDescription
      ? { ...profile.indexDescription, diagnostics: { ...profile.indexDescription.diagnostics } }
      : undefined,
    keywordIndex: { ...profile.keywordIndex },
  };
}
