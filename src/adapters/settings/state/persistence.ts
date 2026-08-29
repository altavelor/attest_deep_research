import {
  DEFAULT_SETTINGS,
  EMPTY_ONBOARDING_PROFILE_IDS,
  cloneIndexProfile,
  cloneWebSourceProfile,
} from "./defaults";
import { readNewChatDefaults } from "./newChatDefaults";
import { normalizeSettingsState } from "./normalization";
import { readUiLanguage } from "./uiLanguage";
import { AttestSettings, OnboardingProfileIds } from "../types";

export function readSettings(savedData: unknown): AttestSettings {
  if (!isCurrentSettings(savedData)) {
    return dropUnknownSettings(DEFAULT_SETTINGS);
  }

  const settings = cloneSettings(savedData);
  normalizeSettingsState(settings);
  return dropUnknownSettings(settings);
}

function cloneSettings(settings: AttestSettings): AttestSettings {
  return {
    ...settings,
    newChatDefaults: readNewChatDefaults(settings),
    uiLanguage: readUiLanguage(settings),
    serverProfiles: settings.serverProfiles.map((profile) => ({ ...profile })),
    webSources: Array.isArray(settings.webSources)
      ? settings.webSources.map(cloneWebSourceProfile)
      : [],
    chatModelProfiles: settings.chatModelProfiles.map((profile) => ({
      ...profile,
      reasoning: { ...profile.reasoning },
      reasoningCapabilities: profile.reasoningCapabilities
        ? {
            ...profile.reasoningCapabilities,
            efforts: [...profile.reasoningCapabilities.efforts],
          }
        : undefined,
      capabilities: profile.capabilities
        ? {
            ...profile.capabilities,
            toolCalling: profile.capabilities.toolCalling
              ? {
                  ...profile.capabilities.toolCalling,
                  formatDefault: { ...profile.capabilities.toolCalling.formatDefault },
                  probe: profile.capabilities.toolCalling.probe
                    ? { ...profile.capabilities.toolCalling.probe }
                    : undefined,
                }
              : undefined,
            reasoningObservation: profile.capabilities.reasoningObservation
              ? {
                  ...profile.capabilities.reasoningObservation,
                  dialects: [...profile.capabilities.reasoningObservation.dialects],
                }
              : undefined,
          }
        : undefined,
    })),
    embeddingModelProfiles: settings.embeddingModelProfiles.map((profile) => ({ ...profile })),
    indexProfiles: settings.indexProfiles.map(cloneIndexProfile),
    includeFolders: [...settings.includeFolders],
    excludeGlobs: [...settings.excludeGlobs],
    modelCapabilityCache: { ...settings.modelCapabilityCache },
  };
}

function dropUnknownSettings(settings: AttestSettings): AttestSettings {
  return {
    serverProfiles: settings.serverProfiles.map((profile) => ({ ...profile })),
    chatModelProfiles: settings.chatModelProfiles.map((profile) => ({
      ...profile,
      reasoning: { ...profile.reasoning },
      reasoningCapabilities: profile.reasoningCapabilities
        ? {
            ...profile.reasoningCapabilities,
            efforts: [...profile.reasoningCapabilities.efforts],
          }
        : undefined,
      capabilities: profile.capabilities
        ? {
            ...profile.capabilities,
            toolCalling: profile.capabilities.toolCalling
              ? {
                  ...profile.capabilities.toolCalling,
                  formatDefault: { ...profile.capabilities.toolCalling.formatDefault },
                  probe: profile.capabilities.toolCalling.probe
                    ? { ...profile.capabilities.toolCalling.probe }
                    : undefined,
                }
              : undefined,
            reasoningObservation: profile.capabilities.reasoningObservation
              ? {
                  ...profile.capabilities.reasoningObservation,
                  dialects: [...profile.capabilities.reasoningObservation.dialects],
                }
              : undefined,
          }
        : undefined,
    })),
    embeddingModelProfiles: settings.embeddingModelProfiles.map((profile) => ({ ...profile })),
    indexProfiles: settings.indexProfiles.map(cloneIndexProfile),
    activeEmbeddingModelProfileId: settings.activeEmbeddingModelProfileId,
    includeFolders: [...settings.includeFolders],
    excludeGlobs: [...settings.excludeGlobs],
    webSources: settings.webSources.map(cloneWebSourceProfile),
    newChatDefaults: readNewChatDefaults(settings),
    uiLanguage: readUiLanguage(settings),
    useLinkedNotes: settings.useLinkedNotes,
    includeBacklinks: settings.includeBacklinks,
    expandFilteredContextThroughLinks: settings.expandFilteredContextThroughLinks,
    graphContextDepth: settings.graphContextDepth,
    useWebWhenFreshnessNeeded: settings.useWebWhenFreshnessNeeded,
    expandSearchQuery: settings.expandSearchQuery,
    downloadFolder: settings.downloadFolder,
    debugMode: settings.debugMode,
    onboardingCompleted: settings.onboardingCompleted === true,
    onboardingProfileIds: readOnboardingProfileIds(settings),
    modelCapabilityCache: { ...settings.modelCapabilityCache },
  };
}

/**
 * Reads the ids of the profiles the wizard created. Saved data is untrusted, so
 * every field falls back to an empty id, which makes the next wizard run create
 * a profile instead of editing one that may not exist.
 */
function readOnboardingProfileIds(settings: AttestSettings): OnboardingProfileIds {
  const stored = (settings as Partial<AttestSettings>).onboardingProfileIds;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { ...EMPTY_ONBOARDING_PROFILE_IDS };
  }

  const ids = stored as Partial<OnboardingProfileIds>;
  const readId = (value: unknown): string => (typeof value === "string" ? value : "");
  return {
    chatServerProfileId: readId(ids.chatServerProfileId),
    chatModelProfileId: readId(ids.chatModelProfileId),
    embeddingServerProfileId: readId(ids.embeddingServerProfileId),
    embeddingModelProfileId: readId(ids.embeddingModelProfileId),
    indexProfileId: readId(ids.indexProfileId),
  };
}

function isCurrentSettings(value: unknown): value is AttestSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const settings = value as Partial<AttestSettings>;
  return (
    Array.isArray(settings.serverProfiles) &&
    Array.isArray(settings.chatModelProfiles) &&
    Array.isArray(settings.embeddingModelProfiles) &&
    typeof settings.activeEmbeddingModelProfileId === "string" &&
    Array.isArray(settings.indexProfiles) &&
    Array.isArray(settings.includeFolders) &&
    Array.isArray(settings.excludeGlobs) &&
    typeof settings.useLinkedNotes === "boolean" &&
    typeof settings.includeBacklinks === "boolean" &&
    typeof settings.expandFilteredContextThroughLinks === "boolean" &&
    typeof settings.graphContextDepth === "number" &&
    typeof settings.useWebWhenFreshnessNeeded === "boolean" &&
    typeof settings.debugMode === "boolean" &&
    settings.modelCapabilityCache !== undefined &&
    typeof settings.modelCapabilityCache === "object" &&
    !Array.isArray(settings.modelCapabilityCache)
  );
}
