import { IndexProfile } from "@adapters/indexing";
import type { Translate } from "@adapters/i18n";
import {
  ChatModelProfile,
  EmbeddingModelProfile,
  AttestSettings,
  ServerProfile,
} from "@adapters/settings";
import {
  getActiveIndexProfile,
  resolveChatModelProfile,
  resolveEmbeddingModelProfile,
  resolveServerProfile,
} from "@adapters/settings";

export function requireChatModelProfile(
  settings: AttestSettings,
  translate: Translate,
  profileId?: string,
): ChatModelProfile {
  const profile = resolveChatModelProfile(settings, profileId);
  if (!profile) {
    throw new Error(translate("profile.error.chatModelMissing"));
  }
  return profile;
}

export function requireEmbeddingModelProfile(
  settings: AttestSettings,
  translate: Translate,
  profileId?: string,
): EmbeddingModelProfile {
  const profile = resolveEmbeddingModelProfile(settings, profileId);
  if (!profile) {
    throw new Error(translate("profile.error.embeddingModelMissing"));
  }
  return profile;
}

export function requireServerProfile(
  settings: AttestSettings,
  translate: Translate,
  profileId: string,
): ServerProfile {
  const profile = resolveServerProfile(settings, profileId);
  if (!profile) {
    throw new Error(translate("profile.error.serverUnavailable"));
  }
  return profile;
}

export function resolveIndexProfileForUse(
  settings: AttestSettings,
  translate: Translate,
  profileId?: string,
): IndexProfile {
  const requested = profileId
    ? settings.indexProfiles.find(
        (profile) =>
          profile.id === profileId &&
          profile.isSuspended !== true &&
          Boolean(profile.lastIndexedAt),
      )
    : undefined;

  const active = getActiveIndexProfile(settings);
  if (active.isSuspended !== true && active.lastIndexedAt) {
    return requested ?? active;
  }

  const firstIndexed = settings.indexProfiles.find(
    (profile) => profile.isSuspended !== true && Boolean(profile.lastIndexedAt),
  );
  if (!requested && !firstIndexed) {
    throw new Error(translate("profile.error.indexNotBuilt"));
  }

  return requested ?? firstIndexed!;
}

export function requireIndexProfile(
  settings: AttestSettings,
  translate: Translate,
  profileId: string,
): IndexProfile {
  const profile = settings.indexProfiles.find((candidate) => candidate.id === profileId);
  if (!profile || profile.isSuspended) {
    throw new Error(translate("profile.error.indexUnavailable"));
  }
  return profile;
}

export function indexSearchEmbedderWarning(
  settings: AttestSettings,
  translate: Translate,
  indexProfileId: string,
): string | undefined {
  const indexProfile = settings.indexProfiles.find((profile) => profile.id === indexProfileId);
  if (!indexProfile) {
    return translate("profile.warning.indexNotSelected");
  }

  const embeddingProfile = settings.embeddingModelProfiles.find(
    (profile) => profile.id === indexProfile.embeddingModelProfileId,
  );
  if (!embeddingProfile) {
    return translate("profile.warning.embeddingProfileUnavailable");
  }
  if (embeddingProfile.isSuspended) {
    return translate("profile.warning.embeddingProfileSuspended");
  }
  if (embeddingProfile.capabilities?.embeddings === false) {
    return translate("profile.warning.embeddingNotSupported");
  }

  const serverProfile = resolveServerProfile(settings, embeddingProfile.serverProfileId);
  if (!serverProfile || serverProfile.isSuspended) {
    return translate("profile.warning.embeddingServerUnavailable");
  }

  return undefined;
}
