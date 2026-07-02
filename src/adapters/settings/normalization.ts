import { areCredentialsComplete, findWebSourceDescriptor } from "@core/web";
import { IndexProfile } from "@adapters/indexing/store/FileVectorIndexStore";
import { DEFAULT_DOWNLOAD_FOLDER, DEFAULT_INDEX_PROFILE_ID } from "./constants";
import { normalizeIndexProfileNumbers, normalizeVaultFolder } from "./parsers";
import { IxplorerSettings } from "./types";

export function normalizeSettingsState(settings: IxplorerSettings): void {
  markInvalidProfilesSuspended(settings);
  normalizeActiveChatModel(settings);
  normalizeActiveEmbeddingModel(settings);
  normalizeIndexProfiles(settings);
  normalizeActiveIndexProfile(settings);
  // Backfilled for settings saved before the download tools existed.
  settings.downloadFolder =
    typeof settings.downloadFolder === "string" && settings.downloadFolder.trim()
      ? normalizeVaultFolder(settings.downloadFolder)
      : DEFAULT_DOWNLOAD_FOLDER;
  migrateLegacyWebSettings(settings);
  normalizeWebSources(settings);
}

/**
 * Settings saved before the web-source hub carried `duckDuckGoEnabled` /
 * `duckDuckGoResultLimit`. The flag becomes a hub profile for the catalog's
 * duckduckgo entry; per-source result limits no longer exist (the planner
 * derives per-source fetch sizes from the tool's requested limit).
 */
function migrateLegacyWebSettings(settings: IxplorerSettings): void {
  const legacy = settings as unknown as Record<string, unknown>;
  if (!Array.isArray(settings.webSources)) {
    settings.webSources = [];
  }

  if (
    legacy.duckDuckGoEnabled === true &&
    !settings.webSources.some((profile) => profile.sourceId === "duckduckgo")
  ) {
    settings.webSources.push({ sourceId: "duckduckgo", enabled: true, credentials: {} });
  }
  delete legacy.duckDuckGoEnabled;
  delete legacy.duckDuckGoResultLimit;
  // Interim field from an unreleased hub iteration.
  delete legacy.webSearchResultLimit;
}

/**
 * Backfills for settings saved before the web-source hub existed; drops entries
 * for sources removed from the catalog and force-disables ones whose required
 * credentials are missing (the UI gates the toggle, this guards stale data).
 */
function normalizeWebSources(settings: IxplorerSettings): void {
  const entries = Array.isArray(settings.webSources) ? settings.webSources : [];
  settings.webSources = entries.flatMap((entry) => {
    const descriptor =
      typeof entry?.sourceId === "string" ? findWebSourceDescriptor(entry.sourceId) : undefined;
    if (!descriptor) {
      return [];
    }
    const credentials =
      typeof entry.credentials === "object" && entry.credentials !== null
        ? Object.fromEntries(
          Object.entries(entry.credentials).filter(
            (pair): pair is [string, string] => typeof pair[1] === "string",
          ),
        )
        : {};
    // Interim per-source field from an unreleased hub iteration.
    delete (entry as unknown as Record<string, unknown>).resultLimit;
    return [
      {
        sourceId: descriptor.id,
        enabled: entry.enabled === true && areCredentialsComplete(descriptor, credentials),
        credentials,
      },
    ];
  });
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
