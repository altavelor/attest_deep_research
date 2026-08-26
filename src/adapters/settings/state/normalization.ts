import {
  areCredentialsComplete,
  findWebSourceDescriptor,
  isWebSourceActivation,
  WebSourceActivation,
} from "@core/web";
import type { IndexProfile } from "@adapters/indexing";
import {
  DEFAULT_DOWNLOAD_FOLDER,
  INVALID_BASE_URL_SUSPENSION_REASON,
  UNVERIFIED_EMBEDDING_SUSPENSION_REASON,
} from "./constants";
import { normalizeNewChatDefaults } from "./newChatDefaults";
import { normalizeIndexProfileNumbers, normalizeVaultFolder } from "./parsers";
import { AttestSettings, ServerProfile } from "../types";

export function normalizeSettingsState(settings: AttestSettings): void {
  markInvalidProfilesSuspended(settings);
  normalizeActiveEmbeddingModel(settings);
  normalizeIndexProfiles(settings);
  normalizeNewChatDefaults(settings);
  settings.downloadFolder =
    typeof settings.downloadFolder === "string" && settings.downloadFolder.trim()
      ? normalizeVaultFolder(settings.downloadFolder)
      : DEFAULT_DOWNLOAD_FOLDER;
  settings.expandSearchQuery =
    typeof settings.expandSearchQuery === "boolean" ? settings.expandSearchQuery : true;
  migrateLegacyWebSettings(settings);
  migrateWebSourceActivation(settings);
  normalizeWebSources(settings);
}

/**
 * Settings saved before the web-source hub carried `duckDuckGoEnabled` /
 * `duckDuckGoResultLimit`. The flag becomes a hub profile for the catalog's
 * duckduckgo entry; per-source result limits no longer exist (the planner
 * derives per-source fetch sizes from the tool's requested limit).
 */
function migrateLegacyWebSettings(settings: AttestSettings): void {
  const legacy = settings as unknown as Record<string, unknown>;
  if (!Array.isArray(settings.webSources)) {
    settings.webSources = [];
  }

  if (
    legacy.duckDuckGoEnabled === true &&
    !settings.webSources.some((profile) => profile.sourceId === "duckduckgo")
  ) {
    settings.webSources.push({ sourceId: "duckduckgo", activation: "auto", credentials: {} });
  }
  delete legacy.duckDuckGoEnabled;
  delete legacy.duckDuckGoResultLimit;
  delete legacy.webSearchResultLimit;
}

/**
 * Settings saved while a source was a plain on/off switch carry `enabled`. A
 * stored `enabled: true` becomes the "auto" activation, everything else becomes
 * "off"; an already valid `activation` is kept, so the pass is idempotent.
 */
function migrateWebSourceActivation(settings: AttestSettings): void {
  for (const profile of settings.webSources) {
    if (typeof profile !== "object" || profile === null) {
      continue;
    }
    const legacy = profile as unknown as Record<string, unknown>;
    if (!isWebSourceActivation(legacy.activation)) {
      profile.activation = legacy.enabled === true ? "auto" : "off";
    }
    delete legacy.enabled;
  }
}

/**
 * Backfills for settings saved before the web-source hub existed; drops entries
 * for sources removed from the catalog and force-disables ones whose required
 * credentials are missing (the UI gates the toggle, this guards stale data).
 */
function normalizeWebSources(settings: AttestSettings): void {
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
    delete (entry as unknown as Record<string, unknown>).resultLimit;
    const activation: WebSourceActivation =
      isWebSourceActivation(entry.activation) && areCredentialsComplete(descriptor, credentials)
        ? entry.activation
        : "off";
    return [
      {
        sourceId: descriptor.id,
        activation,
        credentials,
        ...(descriptor.capabilities?.images === true && entry.imageSearchEnabled === true
          ? { imageSearchEnabled: true }
          : {}),
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

function markInvalidProfilesSuspended(settings: AttestSettings): void {
  for (const server of settings.serverProfiles) {
    if (!isReachableBaseUrl(server.baseUrl)) {
      suspend(server, INVALID_BASE_URL_SUSPENSION_REASON);
      continue;
    }

    if (server.suspendedReason === INVALID_BASE_URL_SUSPENSION_REASON) {
      unsuspend(server);
      continue;
    }

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
      clearServerSuspension(profile, server);
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
      clearServerSuspension(profile, server);
    }
  }
}

/**
 * Lifts a suspension this pass owns while preserving a capability probe's
 * verdict, so it is not silently dropped on the next settings load. The verdict
 * is released once its server has been edited, letting a new probe decide.
 */
function clearServerSuspension(
  profile: { isSuspended?: boolean; suspendedReason?: string; updatedAt: string },
  server: ServerProfile,
): void {
  if (
    profile.isSuspended &&
    profile.suspendedReason === UNVERIFIED_EMBEDDING_SUSPENSION_REASON &&
    server.updatedAt <= profile.updatedAt
  ) {
    return;
  }

  unsuspend(profile);
}

function normalizeActiveEmbeddingModel(settings: AttestSettings): void {
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

function normalizeIndexProfiles(settings: AttestSettings): void {
  for (const profile of settings.indexProfiles) {
    normalizeIndexProfileNumbers(profile);
    const reason = embeddingChainSuspensionReason(settings, profile.embeddingModelProfileId);

    if (reason) {
      suspend(profile, reason);
    } else {
      unsuspend(profile);
    }
  }
}

/**
 * Reports why an index cannot embed: a missing selection, a deleted or
 * suspended embedding model profile, or a server profile it can no longer
 * reach. Returns undefined when the whole chain is usable.
 */
function embeddingChainSuspensionReason(
  settings: AttestSettings,
  embeddingModelProfileId: string,
): string | undefined {
  if (!embeddingModelProfileId) {
    return "Select an embedding model profile.";
  }

  const embedding = settings.embeddingModelProfiles.find(
    (candidate) => candidate.id === embeddingModelProfileId,
  );
  if (!embedding) {
    return "The selected embedding model profile was deleted.";
  }
  if (isProfileSuspended(embedding)) {
    return embedding.suspendedReason ?? "Embedding model profile is suspended.";
  }
  if (!embedding.modelName.trim()) {
    return "The embedding model profile has no model selected.";
  }

  if (!settings.serverProfiles.some((candidate) => candidate.id === embedding.serverProfileId)) {
    return "Server profile was deleted.";
  }

  return undefined;
}

function isReachableBaseUrl(baseUrl: string): boolean {
  try {
    const { protocol } = new URL(baseUrl.trim());
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
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
