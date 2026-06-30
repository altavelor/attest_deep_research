import { IndexProfile } from "../indexing/store/FileVectorIndexStore";
import { DEFAULT_INDEX_PROFILE_ID } from "./constants";
import { normalizeIndexProfileNumbers } from "./parsers";
import { IxplorerSettings } from "./types";

export function normalizeSettingsState(settings: IxplorerSettings): void {
  markInvalidProfilesSuspended(settings);
  normalizeActiveChatModel(settings);
  normalizeActiveEmbeddingModel(settings);
  normalizeIndexProfiles(settings);
  normalizeActiveIndexProfile(settings);
}

export function isProfileSuspended(profile: { isSuspended?: boolean }): boolean {
  return profile.isSuspended === true;
}

export function isIndexProfileSelectable(
  profile: Pick<IndexProfile, "isSuspended" | "lastIndexedAt">,
): boolean {
  return !isProfileSuspended(profile) && Boolean(profile.lastIndexedAt);
}

export function isProfileActive<T extends { isSuspended?: boolean }>(profile: T): boolean {
  return !isProfileSuspended(profile);
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
