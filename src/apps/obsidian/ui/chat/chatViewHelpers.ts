import { ResearchAnswer } from "@core/answer";
import { SavedChatSettings } from "@core/chat/savedChat";
import { parsePositiveInteger } from "@shared";
import { ChatModelSelectOption, IndexProfileSelectOption } from "./ChatComposer";

/** Services subset needed to resolve chat settings against currently available profiles. */
export interface ChatSettingsServices {
  getChatModelProfiles(): ChatModelSelectOption[];
  getDefaultChatModelProfileId(): string;
  getIndexProfiles(): IndexProfileSelectOption[];
  getDefaultIndexProfileId(): string;
}

export function stripContextDiagnostics(answer: ResearchAnswer | null): ResearchAnswer | null {
  if (!answer?.contextDiagnostics) {
    return answer;
  }

  const { contextDiagnostics: _contextDiagnostics, ...rest } = answer;
  return rest;
}

export function readPositiveInteger(value: string | undefined, fallback: number): number {
  return parsePositiveInteger(value) ?? fallback;
}

export function readOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseFloat(value.replace(",", "."));

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveAvailableChatModelProfileId(
  profiles: ChatModelSelectOption[],
  requestedId: string | undefined,
  fallbackId: string,
): string {
  if (
    requestedId &&
    profiles.some((profile) => profile.id === requestedId && !profile.isSuspended)
  ) {
    return requestedId;
  }

  if (fallbackId && profiles.some((profile) => profile.id === fallbackId && !profile.isSuspended)) {
    return fallbackId;
  }

  return profiles.find((profile) => !profile.isSuspended)?.id ?? "";
}

export function resolveAvailableIndexProfileId(
  profiles: IndexProfileSelectOption[],
  requestedId: string | undefined,
  fallbackId: string,
): string {
  if (
    requestedId &&
    profiles.some(
      (profile) => profile.id === requestedId && !profile.isSuspended && profile.isIndexed,
    )
  ) {
    return requestedId;
  }

  if (
    fallbackId &&
    profiles.some(
      (profile) => profile.id === fallbackId && !profile.isSuspended && profile.isIndexed,
    )
  ) {
    return fallbackId;
  }

  return profiles.find((profile) => !profile.isSuspended && profile.isIndexed)?.id ?? "";
}

export function chatModelProfileLabel(
  profiles: ChatModelSelectOption[],
  profileId: string | undefined,
): string {
  return profiles.find((profile) => profile.id === profileId)?.name ?? "";
}

export function normalizeExtensionFilter(value: string): string | undefined {
  const normalized = value.trim().replace(/^\./, "").toLowerCase();

  return normalized || undefined;
}

export function createDefaultChatSettings(services: ChatSettingsServices): SavedChatSettings {
  const indexProfiles = services.getIndexProfiles();
  return {
    chatModelProfileId: resolveAvailableChatModelProfileId(
      services.getChatModelProfiles(),
      services.getDefaultChatModelProfileId(),
      "",
    ),
    indexProfileId: resolveAvailableIndexProfileId(
      indexProfiles,
      services.getDefaultIndexProfileId(),
      indexProfiles.find((profile) => !profile.isSuspended)?.id ?? "",
    ),
    searchMode: "indexOnly",
    contextMode: "include",
  };
}

export function resolveChatSettings(
  services: ChatSettingsServices,
  settings: SavedChatSettings,
): SavedChatSettings {
  const defaults = createDefaultChatSettings(services);

  return {
    chatModelProfileId: resolveAvailableChatModelProfileId(
      services.getChatModelProfiles(),
      settings.chatModelProfileId,
      defaults.chatModelProfileId,
    ),
    indexProfileId: resolveAvailableIndexProfileId(
      services.getIndexProfiles(),
      settings.indexProfileId,
      defaults.indexProfileId ?? "",
    ),
    searchMode: settings.searchMode,
    contextMode: settings.contextMode ?? defaults.contextMode,
  };
}
