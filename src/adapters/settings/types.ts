import { ApiFormat } from "../../core/agent/protocol";
import { IndexProfile } from "../indexing/FileVectorIndexStore";
import { ToolCapabilitySettings } from "./toolCapabilities";
import { ModelCapabilitySnapshot } from "./modelCapabilityCache";

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
  duckDuckGoResultLimit: number;
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
