import { DEFAULT_SETTINGS, cloneIndexProfile } from "./defaults";
import { readNewChatDefaults } from "./newChatDefaults";
import { normalizeSettingsState } from "./normalization";
import { IxplorerSettings } from "./types";

export function readSettings(savedData: unknown): IxplorerSettings {
  if (!isCurrentSettings(savedData)) {
    return cloneSettings(DEFAULT_SETTINGS);
  }

  const settings = cloneSettings(savedData);
  normalizeSettingsState(settings);
  return settings;
}

function cloneSettings(settings: IxplorerSettings): IxplorerSettings {
  const {
    forceEagerResearch: _ignoredLegacyForceEagerResearch,
    showChatIndexControl: _ignoredLegacyShowChatIndexControl,
    activeChatModelProfileId: _ignoredLegacyActiveChatModelProfileId,
    activeIndexProfileId: _ignoredLegacyActiveIndexProfileId,
    includeActiveFileContext: _ignoredLegacyIncludeActiveFileContext,
    ...currentSettings
  } = settings as IxplorerSettings & {
    forceEagerResearch?: unknown;
    showChatIndexControl?: unknown;
    activeChatModelProfileId?: unknown;
    activeIndexProfileId?: unknown;
    includeActiveFileContext?: unknown;
  };

  return {
    ...currentSettings,
    newChatDefaults: readNewChatDefaults(settings),
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
    includeFolders: [...settings.includeFolders],
    excludeGlobs: [...settings.excludeGlobs],
    modelCapabilityCache: { ...settings.modelCapabilityCache },
  };
}

function isCurrentSettings(value: unknown): value is IxplorerSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const settings = value as Partial<IxplorerSettings>;
  return (
    Array.isArray(settings.serverProfiles) &&
    Array.isArray(settings.chatModelProfiles) &&
    Array.isArray(settings.embeddingModelProfiles) &&
    typeof settings.activeEmbeddingModelProfileId === "string" &&
    typeof settings.lanceDbFolder === "string" &&
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
