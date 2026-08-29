import { ApiFormat } from "@core/agent";
import type { LocalePreference } from "@core/i18n";
import type { WebSourceProfile } from "@core/web";
import type { IndexProfile } from "@adapters/indexing";
import { ModelCapabilitySnapshot, ToolCapabilitySettings } from "./capabilities/contracts";

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

export type NewChatSearchMode = "none" | "indexOnly" | "webOnly" | "indexAndWeb";

export type NewChatResearchMode = "instant" | "thinking";

export interface NewChatDefaults {
  searchMode: NewChatSearchMode;
  indexProfileId: string;
  researchMode: NewChatResearchMode;
  chatModelProfileId: string;
  includeActiveFileContext: boolean;
}

/**
 * Identifies the profiles the first-run wizard created. A later run edits these
 * rather than adding a second set, so re-running it reconfigures the vault
 * instead of filling the settings screens with near-duplicates.
 */
export interface OnboardingProfileIds {
  chatServerProfileId: string;
  chatModelProfileId: string;
  embeddingServerProfileId: string;
  embeddingModelProfileId: string;
  indexProfileId: string;
}

export interface AttestSettings {
  serverProfiles: ServerProfile[];
  chatModelProfiles: ChatModelProfile[];
  embeddingModelProfiles: EmbeddingModelProfile[];
  activeEmbeddingModelProfileId: string;
  indexProfiles: IndexProfile[];
  includeFolders: string[];
  excludeGlobs: string[];
  webSources: WebSourceProfile[];
  newChatDefaults: NewChatDefaults;
  uiLanguage: LocalePreference;
  useLinkedNotes: boolean;
  includeBacklinks: boolean;
  expandFilteredContextThroughLinks: boolean;
  graphContextDepth: number;
  useWebWhenFreshnessNeeded: boolean;
  expandSearchQuery: boolean;
  downloadFolder: string;
  debugMode: boolean;
  onboardingCompleted: boolean;
  onboardingProfileIds: OnboardingProfileIds;
  modelCapabilityCache: Record<string, ModelCapabilitySnapshot>;
}
