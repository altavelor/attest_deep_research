import { ChatApiProtocol } from "@core/agent";
import { IndexProfile } from "@adapters/indexing/store/FileVectorIndexStore";
import { MAX_PROFILE_NAME_LENGTH } from "./constants";
import { cloneIndexProfile, DEFAULT_INDEX_PROFILE } from "./defaults";
import { isProfileActive, isProfileSuspended, normalizeSettingsState } from "./normalization";
import { normalizeIndexProfileNumbers, normalizeProfileName } from "./parsers";
import { resolveToolCapabilities } from "./toolCapabilities";
import { ChatModelProfile, EmbeddingModelProfile, AttestSettings, ServerProfile } from "./types";

const INDEX_PROFILE_NAME_PATTERN = /^[\p{L}\p{N} _.\-()[\]]+$/u;

export function getActiveIndexProfile(settings: AttestSettings): IndexProfile {
  return (
    settings.indexProfiles.find(
      (profile) =>
        profile.id === settings.newChatDefaults.indexProfileId && isProfileActive(profile),
    ) ??
    settings.indexProfiles.find(isProfileActive) ??
    settings.indexProfiles[0] ??
    cloneIndexProfile(DEFAULT_INDEX_PROFILE)
  );
}

export function updateActiveIndexProfile(
  settings: AttestSettings,
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
    settings.newChatDefaults.indexProfileId = updatedProfile.id;
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

export function getActiveChatModelProfile(settings: AttestSettings): ChatModelProfile | undefined {
  return settings.chatModelProfiles.find(
    (profile) =>
      profile.id === settings.newChatDefaults.chatModelProfileId && !isProfileSuspended(profile),
  );
}

export function resolveChatModelProfile(
  settings: AttestSettings,
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
  settings: AttestSettings,
  profileId: string | undefined,
): EmbeddingModelProfile | undefined {
  return settings.embeddingModelProfiles.find(
    (profile) => profile.id === profileId && !isProfileSuspended(profile),
  );
}

export function resolveServerProfile(
  settings: AttestSettings,
  profileId: string | undefined,
): ServerProfile | undefined {
  return settings.serverProfiles.find(
    (profile) => profile.id === profileId && !isProfileSuspended(profile),
  );
}

export function canDeleteServerProfile(settings: AttestSettings, serverProfileId: string): boolean {
  return (
    !settings.chatModelProfiles.some((profile) => profile.serverProfileId === serverProfileId) &&
    !settings.embeddingModelProfiles.some((profile) => profile.serverProfileId === serverProfileId)
  );
}

export function canDeleteEmbeddingModelProfile(
  settings: AttestSettings,
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

export function createProfileId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
