import type { OnboardingScope } from "@core/onboarding";
import { scopeNeedsIndex, searchModeForScope } from "@core/onboarding";
import { modelDisplayName } from "@core/agent";
import { createProfileId, hasDuplicateProfileName } from "./queries";
import type { IndexProfile } from "@adapters/indexing";
import type {
  AttestSettings,
  ReasoningCapabilitySettings,
  ChatModelProfile,
  EmbeddingModelProfile,
  ModelCapability,
  ServerProfile,
} from "./types";
import { advertisedToolCapabilities, reasoningCapabilitiesFromSnapshot } from "./capabilities";
import type { ModelCapabilitySnapshot } from "./capabilities";
import {
  EMPTY_ONBOARDING_PROFILE_IDS,
  createIndexProfile,
  MAX_PROFILE_NAME_LENGTH,
  DEFAULT_INDEX_FOLDER,
  DEFAULT_INDEX_PROFILE_ID,
  DEFAULT_INDEX_PROFILE_NAME,
  normalizeUrl,
  UNVERIFIED_EMBEDDING_SUSPENSION_REASON,
} from "./state";

export interface OnboardingServerDraft {
  name: string;
  apiFormat: ServerProfile["apiFormat"];
  baseUrl: string;
  apiKey?: string;
}

export interface OnboardingModelDraft {
  server: OnboardingServerDraft;
  modelName: string;
  capabilities?: ModelCapability;
  capabilitySnapshot?: ModelCapabilitySnapshot;
}

export interface OnboardingIndexDraft {
  mode: "wholeVault" | "selected";
  indexFolder?: string;
  includeFolders: string[];
  excludeGlobs: string[];
}

export interface OnboardingResult {
  scope: OnboardingScope;
  chat: OnboardingModelDraft;
  embedding?: OnboardingModelDraft & { verified: boolean };
  index?: OnboardingIndexDraft;
}

export interface AppliedOnboarding {
  chatModelProfileId: string;
  indexProfileId?: string;
  embeddingModelProfileId?: string;
}

export interface OnboardingEndpointPrefill {
  server: OnboardingServerDraft;
  modelName: string;
}

export interface OnboardingPrefill {
  chat?: OnboardingEndpointPrefill;
  embedding?: OnboardingEndpointPrefill;
  embeddingSameAsChat: boolean;
  index?: OnboardingIndexDraft;
}

/**
 * Writes the profiles a completed wizard run describes into settings. A second
 * run edits the profiles the first one created instead of adding a near-duplicate
 * set, and the ids of those profiles are recorded so the next run can find them.
 * A profile the wizard did not create is never adopted, and a name or probed
 * capability the user already has survives a run that keeps the same model.
 */
export function applyOnboardingResult(
  settings: AttestSettings,
  result: OnboardingResult,
  now = new Date().toISOString(),
): AppliedOnboarding {
  const created = settings.onboardingProfileIds ?? EMPTY_ONBOARDING_PROFILE_IDS;
  const chatServer = upsertServerProfile(
    settings,
    result.chat.server,
    created.chatServerProfileId,
    now,
  );
  const chatProfile = upsertChatModelProfile(
    settings,
    result.chat,
    chatServer.id,
    created.chatModelProfileId,
    now,
  );
  settings.newChatDefaults.chatModelProfileId = chatProfile.id;
  settings.newChatDefaults.searchMode = searchModeForScope(result.scope);
  settings.onboardingCompleted = true;
  settings.onboardingProfileIds = {
    ...created,
    chatServerProfileId: chatServer.id,
    chatModelProfileId: chatProfile.id,
  };

  const applied: AppliedOnboarding = { chatModelProfileId: chatProfile.id };
  if (!result.embedding || !scopeNeedsIndex(result.scope)) {
    return applied;
  }

  const embeddingServer = reuseOrUpsertServerProfile(
    settings,
    result.embedding.server,
    chatServer,
    created.embeddingServerProfileId,
    now,
  );
  const embeddingProfile = upsertEmbeddingModelProfile(
    settings,
    result.embedding,
    embeddingServer.id,
    created.embeddingModelProfileId,
    now,
  );
  settings.activeEmbeddingModelProfileId = embeddingProfile.id;
  settings.onboardingProfileIds = {
    ...settings.onboardingProfileIds,
    embeddingServerProfileId: embeddingServer.id,
    embeddingModelProfileId: embeddingProfile.id,
  };
  applied.embeddingModelProfileId = embeddingProfile.id;

  if (!result.index) {
    return applied;
  }

  const indexProfile = configureIndexProfile(
    settings,
    result.index,
    embeddingProfile.id,
    created.indexProfileId,
    now,
  );
  settings.newChatDefaults.indexProfileId = indexProfile.id;
  settings.onboardingProfileIds = {
    ...settings.onboardingProfileIds,
    indexProfileId: indexProfile.id,
  };
  applied.indexProfileId = indexProfile.id;
  return applied;
}

/**
 * Reproduces the answers behind the profiles the wizard created, so a re-run
 * opens on the current setup instead of an empty form. Returns undefined when
 * no wizard-created chat profile survives, which is the first-run case.
 */
export function onboardingPrefill(settings: AttestSettings): OnboardingPrefill | undefined {
  const created = settings.onboardingProfileIds;
  if (!created) {
    return undefined;
  }

  const chatProfile = settings.chatModelProfiles.find(
    (profile) => profile.id === created.chatModelProfileId,
  );
  const chatServer = settings.serverProfiles.find(
    (profile) => profile.id === created.chatServerProfileId,
  );
  if (!chatProfile || !chatServer) {
    return undefined;
  }

  const prefill: OnboardingPrefill = {
    chat: { server: serverDraftFrom(chatServer), modelName: chatProfile.modelName },
    embeddingSameAsChat: true,
  };

  const embeddingProfile = settings.embeddingModelProfiles.find(
    (profile) => profile.id === created.embeddingModelProfileId,
  );
  const embeddingServer = settings.serverProfiles.find(
    (profile) => profile.id === created.embeddingServerProfileId,
  );
  if (embeddingProfile && embeddingServer) {
    prefill.embedding = {
      server: serverDraftFrom(embeddingServer),
      modelName: embeddingProfile.modelName,
    };
    prefill.embeddingSameAsChat = embeddingServer.id === chatServer.id;
  }

  const indexProfile = settings.indexProfiles.find(
    (profile) => profile.id === created.indexProfileId,
  );
  if (indexProfile) {
    prefill.index = {
      mode: indexProfile.mode === "selected" ? "selected" : "wholeVault",
      indexFolder: indexProfile.indexFolder,
      includeFolders: [...indexProfile.includeFolders],
      excludeGlobs: [...indexProfile.excludeGlobs],
    };
  }

  return prefill;
}

function serverDraftFrom(profile: ServerProfile): OnboardingServerDraft {
  return {
    name: profile.name,
    apiFormat: profile.apiFormat,
    baseUrl: profile.baseUrl,
    ...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
  };
}

function upsertServerProfile(
  settings: AttestSettings,
  draft: OnboardingServerDraft,
  existingId: string,
  now: string,
): ServerProfile {
  const existing = settings.serverProfiles.find((profile) => profile.id === existingId);
  const baseUrl = normalizeUrl(draft.baseUrl, "");
  if (!existing) {
    const profile: ServerProfile = {
      id: createProfileId("server"),
      name: uniqueProfileName(settings.serverProfiles, onboardingProfileName(draft.name)),
      apiFormat: draft.apiFormat,
      baseUrl,
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      createdAt: now,
      updatedAt: now,
    };
    settings.serverProfiles.push(profile);
    return profile;
  }

  existing.name = uniqueProfileName(
    settings.serverProfiles,
    onboardingProfileName(draft.name),
    existing.id,
  );
  existing.apiFormat = draft.apiFormat;
  existing.baseUrl = baseUrl;
  if (draft.apiKey) {
    existing.apiKey = draft.apiKey;
  } else {
    delete existing.apiKey;
  }
  existing.updatedAt = now;
  return existing;
}

function reuseOrUpsertServerProfile(
  settings: AttestSettings,
  draft: OnboardingServerDraft,
  chatServer: ServerProfile,
  existingId: string,
  now: string,
): ServerProfile {
  const sameEndpoint =
    normalizeUrl(draft.baseUrl, "") === chatServer.baseUrl &&
    draft.apiFormat === chatServer.apiFormat &&
    (draft.apiKey ?? "") === (chatServer.apiKey ?? "");
  if (sameEndpoint) {
    dropUnusedOnboardingServer(settings, existingId, chatServer.id);
    return chatServer;
  }

  return upsertServerProfile(settings, draft, existingId === chatServer.id ? "" : existingId, now);
}

/**
 * Removes the separate embedding server a previous run created once both models
 * moved onto one endpoint. Anything else referencing it keeps it, so a profile
 * the user attached by hand is never deleted underneath them.
 */
function dropUnusedOnboardingServer(
  settings: AttestSettings,
  serverProfileId: string,
  chatServerProfileId: string,
): void {
  if (!serverProfileId || serverProfileId === chatServerProfileId) {
    return;
  }

  const referenced =
    settings.chatModelProfiles.some((profile) => profile.serverProfileId === serverProfileId) ||
    settings.embeddingModelProfiles.some(
      (profile) =>
        profile.serverProfileId === serverProfileId &&
        profile.id !== settings.onboardingProfileIds?.embeddingModelProfileId,
    );
  if (referenced) {
    return;
  }

  settings.serverProfiles = settings.serverProfiles.filter(
    (profile) => profile.id !== serverProfileId,
  );
}

function upsertChatModelProfile(
  settings: AttestSettings,
  draft: OnboardingModelDraft,
  serverProfileId: string,
  existingId: string,
  now: string,
): ChatModelProfile {
  const existing = settings.chatModelProfiles.find((profile) => profile.id === existingId);
  const capabilities: ModelCapability = {
    ...(draft.capabilities ?? formatDefaultCapabilities()),
    chat: true,
    toolCalling: advertisedToolCapabilities({
      capabilities: draft.capabilities ?? {},
      capabilitySnapshot: draft.capabilitySnapshot,
    }),
  };
  const reasoningCapabilities = reasoningCapabilitiesFromSnapshot(draft.capabilitySnapshot);
  if (!existing) {
    const profile: ChatModelProfile = {
      id: createProfileId("chat-model"),
      name: generatedModelName(settings.chatModelProfiles, draft.modelName),
      serverProfileId,
      modelName: draft.modelName,
      toolsEnabled: true,
      noteMutationAccess: true,
      reasoning: reasoningDefaults(reasoningCapabilities),
      ...(reasoningCapabilities ? { reasoningCapabilities } : {}),
      capabilities,
      createdAt: now,
      updatedAt: now,
    };
    settings.chatModelProfiles.push(profile);
    return profile;
  }

  if (existing.modelName !== draft.modelName) {
    existing.name = generatedModelName(settings.chatModelProfiles, draft.modelName, existing.id);
  }
  existing.serverProfileId = serverProfileId;
  existing.modelName = draft.modelName;
  if (draft.capabilities) {
    existing.capabilities = capabilities;
  }
  if (reasoningCapabilities && existing.reasoningCapabilities?.source !== "probe") {
    existing.reasoningCapabilities = reasoningCapabilities;
  }
  existing.updatedAt = now;
  return existing;
}

function upsertEmbeddingModelProfile(
  settings: AttestSettings,
  draft: OnboardingModelDraft & { verified: boolean },
  serverProfileId: string,
  existingId: string,
  now: string,
): EmbeddingModelProfile {
  const existing = settings.embeddingModelProfiles.find((profile) => profile.id === existingId);
  const capabilities: ModelCapability = {
    chat: false,
    embeddings: draft.verified,
    detectionSource: "probe",
  };
  const suspension = draft.verified
    ? {}
    : { isSuspended: true, suspendedReason: UNVERIFIED_EMBEDDING_SUSPENSION_REASON };
  if (!existing) {
    const profile: EmbeddingModelProfile = {
      id: createProfileId("embedding-model"),
      name: generatedModelName(settings.embeddingModelProfiles, draft.modelName),
      serverProfileId,
      modelName: draft.modelName,
      capabilities,
      ...suspension,
      createdAt: now,
      updatedAt: now,
    };
    settings.embeddingModelProfiles.push(profile);
    return profile;
  }

  if (existing.modelName !== draft.modelName) {
    existing.name = generatedModelName(
      settings.embeddingModelProfiles,
      draft.modelName,
      existing.id,
    );
  }
  existing.serverProfileId = serverProfileId;
  existing.modelName = draft.modelName;
  existing.capabilities = capabilities;
  if (draft.verified) {
    delete existing.isSuspended;
    delete existing.suspendedReason;
  } else {
    existing.isSuspended = true;
    existing.suspendedReason = UNVERIFIED_EMBEDDING_SUSPENSION_REASON;
  }
  existing.updatedAt = now;
  return existing;
}

function generatedModelName<T extends { id: string; name: string }>(
  profiles: T[],
  modelName: string,
  currentId?: string,
): string {
  const generated = onboardingProfileName(modelDisplayName(modelName) || modelName);
  return uniqueProfileName(profiles, generated, currentId);
}

function configureIndexProfile(
  settings: AttestSettings,
  draft: OnboardingIndexDraft,
  embeddingModelProfileId: string,
  existingId: string,
  now: string,
): IndexProfile {
  const existing = settings.indexProfiles.find((profile) => profile.id === existingId);
  const profile = createIndexProfile({
    ...(existing ?? {}),
    id: existing?.id ?? newIndexProfileId(settings),
    name: existing?.name ?? uniqueProfileName(settings.indexProfiles, DEFAULT_INDEX_PROFILE_NAME),
    mode: draft.mode,
    indexFolder: draft.indexFolder || existing?.indexFolder || DEFAULT_INDEX_FOLDER,
    includeFolders: draft.mode === "wholeVault" ? ["/"] : draft.includeFolders,
    excludeGlobs: draft.mode === "wholeVault" ? draft.excludeGlobs : [],
    embeddingModelProfileId,
    isSuspended: false,
    suspendedReason: undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  if (existing) {
    settings.indexProfiles[settings.indexProfiles.indexOf(existing)] = profile;
  } else {
    settings.indexProfiles.push(profile);
  }
  settings.includeFolders = [...profile.includeFolders];
  settings.excludeGlobs = [...profile.excludeGlobs];
  return profile;
}

/**
 * Names an index profile the wizard is about to create. Only a vault with no
 * index at all gets the seeded default id; anywhere else the wizard takes a
 * fresh id, so a profile the user configured by hand is never overwritten.
 */
function newIndexProfileId(settings: AttestSettings): string {
  return settings.indexProfiles.length === 0 ? DEFAULT_INDEX_PROFILE_ID : createProfileId("index");
}

/**
 * Starts a chat profile on the reasoning settings the provider advertises. A
 * model with no advertised reasoning keeps the neutral defaults, so nothing is
 * claimed that the metadata did not report.
 */
function reasoningDefaults(
  capabilities: ReasoningCapabilitySettings | undefined,
): ChatModelProfile["reasoning"] {
  return {
    mode: "auto",
    summary: capabilities?.summary ? "auto" : "off",
    ...(capabilities?.defaultEffort ? { effort: capabilities.defaultEffort } : {}),
  };
}

function formatDefaultCapabilities(): ModelCapability {
  return { chat: true, embeddings: false, detectionSource: "format-default" };
}

/**
 * Fits a generated profile name into the length the settings screens accept.
 * Provider-qualified model ids often exceed it, and a name that fails
 * validation would leave a profile the user cannot save again by hand.
 */
export function onboardingProfileName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= MAX_PROFILE_NAME_LENGTH) {
    return trimmed;
  }

  const lastSegment = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (lastSegment.length > 0 && lastSegment.length <= MAX_PROFILE_NAME_LENGTH) {
    return lastSegment;
  }

  return (lastSegment || trimmed).slice(0, MAX_PROFILE_NAME_LENGTH).trim();
}

/**
 * Keeps a generated name free of collisions. The settings screens refuse to
 * save a duplicate name, so a second wizard run must not leave two profiles
 * the user can no longer edit. A profile being updated is excluded through
 * `currentId`, which keeps its own name from colliding with itself.
 */
export function uniqueProfileName<T extends { id: string; name: string }>(
  profiles: T[],
  name: string,
  currentId?: string,
): string {
  if (!hasDuplicateProfileName(profiles, name, currentId)) {
    return name;
  }

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const marker = ` ${suffix}`;
    const base = name.slice(0, MAX_PROFILE_NAME_LENGTH - marker.length).trimEnd();
    const candidate = `${base}${marker}`;
    if (!hasDuplicateProfileName(profiles, candidate, currentId)) {
      return candidate;
    }
  }

  return name;
}
