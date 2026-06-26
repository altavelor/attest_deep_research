import { DEFAULT_CHUNK_LENGTH, DEFAULT_CHUNK_OVERLAP } from "../extractors/common";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_PDF_CHUNK_OVERLAP,
  DEFAULT_PDF_CHUNK_SIZE,
  IndexProfile,
} from "../indexing/FileVectorIndexStore";
import { isPositiveInteger } from "../../shared/numbers";
import {
  DEFAULT_INDEX_PROFILE_ID,
  DEFAULT_PROFILE_TIMESTAMP,
  MAX_INDEX_PROFILE_COUNT,
} from "./constants";
import { createIndexProfile, DEFAULT_SETTINGS } from "./defaults";
import { normalizeSettingsState } from "./normalization";
import {
  isSettingsRecord,
  normalizeChunkOverlap,
  normalizeProfileName,
  normalizeUrl,
  normalizeVaultFolder,
  readActiveIndexProfileId,
  readApiFormat,
  readIndexDescription,
  readIndexMode,
  readNonNegativeInteger,
  readNonNegativeIntegerOrUndefined,
  readOptionalNumber,
  readOptionalPositiveInteger,
  readPositiveInteger,
  readString,
  readStringList,
} from "./parsers";
import {
  ChatModelProfile,
  EmbeddingModelProfile,
  IxplorerSettings,
  ModelCapability,
  ReasoningCapabilitySettings,
  ReasoningProfileSettings,
  ServerProfile,
} from "./types";
import { normalizeToolCapabilitySettings } from "./toolCapabilities";
import { readModelCapabilityCache } from "./modelCapabilityCache";

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

function readGraphContextDepth(value: unknown): number {
  return value === 2 ? 2 : DEFAULT_SETTINGS.graphContextDepth;
}
