import { DEFAULT_CHUNK_LENGTH, DEFAULT_CHUNK_OVERLAP } from "@adapters/extractors/common";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_FILE_VECTOR_SHARD_COUNT,
  DEFAULT_KEYWORD_MIN_TOKEN_LENGTH,
  DEFAULT_PDF_CHUNK_OVERLAP,
  DEFAULT_PDF_CHUNK_SIZE,
  IndexProfile,
} from "@adapters/indexing/store/FileVectorIndexStore";
import {
  DEFAULT_DOWNLOAD_FOLDER,
  DEFAULT_INDEX_FOLDER,
  DEFAULT_INDEX_PROFILE_ID,
  DEFAULT_PROFILE_TIMESTAMP,
} from "./constants";
import { DEFAULT_NEW_CHAT_DEFAULTS } from "./newChatDefaults";
import { normalizeIndexProfileNumbers, normalizeVaultFolder } from "./parsers";
import { IxplorerSettings } from "./types";

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
  activeEmbeddingModelProfileId: "",
  lanceDbFolder: DEFAULT_INDEX_FOLDER,
  indexProfiles: [cloneIndexProfile(DEFAULT_INDEX_PROFILE)],
  includeFolders: [...DEFAULT_INDEX_PROFILE.includeFolders],
  excludeGlobs: [...DEFAULT_INDEX_PROFILE.excludeGlobs],
  webSources: [],
  newChatDefaults: { ...DEFAULT_NEW_CHAT_DEFAULTS },
  useLinkedNotes: true,
  includeBacklinks: true,
  expandFilteredContextThroughLinks: false,
  graphContextDepth: 1,
  useWebWhenFreshnessNeeded: true,
  expandSearchQuery: true,
  downloadFolder: DEFAULT_DOWNLOAD_FOLDER,
  debugMode: false,
  modelCapabilityCache: {},
};

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

export function cloneIndexProfile(profile: IndexProfile): IndexProfile {
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
