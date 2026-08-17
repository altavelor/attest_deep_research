import { reasoningVerified } from "../capabilities";
import { ChatModelProfile, AttestSettings, NewChatDefaults, NewChatSearchMode } from "../types";

export const NEW_CHAT_SEARCH_MODES: NewChatSearchMode[] = [
  "none",
  "indexOnly",
  "webOnly",
  "indexAndWeb",
];

export const NEW_CHAT_SEARCH_MODE_LABELS: Record<NewChatSearchMode, string> = {
  none: "None",
  indexOnly: "Index",
  webOnly: "Web",
  indexAndWeb: "Index + Web",
};

export const DEFAULT_NEW_CHAT_DEFAULTS: NewChatDefaults = {
  searchMode: "indexOnly",
  indexProfileId: "",
  researchMode: "instant",
  chatModelProfileId: "",
  includeActiveFileContext: true,
};

/**
 * Reads the new-chat defaults from saved settings, migrating installations that
 * still carry the removed `activeChatModelProfileId`, `activeIndexProfileId`,
 * and top-level `includeActiveFileContext` keys.
 */
export function readNewChatDefaults(savedSettings: unknown): NewChatDefaults {
  const saved = asRecord(savedSettings);
  const legacy = isRecord(saved.newChatDefaults) ? {} : saved;
  const group = asRecord(saved.newChatDefaults);
  return {
    searchMode: isSearchMode(group.searchMode) ? group.searchMode : "indexOnly",
    indexProfileId: readProfileId(group.indexProfileId, legacy.activeIndexProfileId),
    researchMode: group.researchMode === "thinking" ? "thinking" : "instant",
    chatModelProfileId: readProfileId(group.chatModelProfileId, legacy.activeChatModelProfileId),
    includeActiveFileContext: readBoolean(
      group.includeActiveFileContext,
      legacy.includeActiveFileContext,
    ),
  };
}

/**
 * Replaces deleted, suspended, or otherwise unavailable default selections with
 * the first available profile, and degrades `thinking` to `instant` when the
 * default chat model has no verified agent capability.
 */
export function normalizeNewChatDefaults(settings: AttestSettings): void {
  const defaults = { ...DEFAULT_NEW_CHAT_DEFAULTS, ...settings.newChatDefaults };

  defaults.searchMode = isSearchMode(defaults.searchMode) ? defaults.searchMode : "indexOnly";
  defaults.includeActiveFileContext = defaults.includeActiveFileContext !== false;
  defaults.chatModelProfileId = availableProfileId(
    settings.chatModelProfiles,
    defaults.chatModelProfileId,
  );
  defaults.indexProfileId = availableProfileId(settings.indexProfiles, defaults.indexProfileId);

  const model = settings.chatModelProfiles.find(
    (profile) => profile.id === defaults.chatModelProfileId,
  );
  if (defaults.researchMode !== "thinking" || !supportsThinkingMode(model)) {
    defaults.researchMode = "instant";
  }

  settings.newChatDefaults = defaults;
}

export function supportsThinkingMode(
  profile: Pick<ChatModelProfile, "reasoningCapabilities"> | undefined,
): boolean {
  return profile !== undefined && reasoningVerified(profile.reasoningCapabilities);
}

function availableProfileId(
  profiles: Array<{ id: string; isSuspended?: boolean }>,
  requestedId: string,
): string {
  const isAvailable = (profile: { isSuspended?: boolean }): boolean => profile.isSuspended !== true;
  if (
    requestedId &&
    profiles.some((profile) => profile.id === requestedId && isAvailable(profile))
  ) {
    return requestedId;
  }

  return profiles.find(isAvailable)?.id ?? "";
}

function readProfileId(value: unknown, legacyValue: unknown): string {
  if (typeof value === "string") return value;
  return typeof legacyValue === "string" ? legacyValue : "";
}

function readBoolean(value: unknown, legacyValue: unknown): boolean {
  if (typeof value === "boolean") return value;
  return typeof legacyValue === "boolean" ? legacyValue : true;
}

function isSearchMode(value: unknown): value is NewChatSearchMode {
  return NEW_CHAT_SEARCH_MODES.includes(value as NewChatSearchMode);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
