import { IndexProfile } from "@adapters/indexing";
import {
  ChatModelProfile,
  EmbeddingModelProfile,
  IxplorerSettings,
  ServerProfile,
} from "@adapters/settings";
import {
  getActiveIndexProfile,
  resolveChatModelProfile,
  resolveEmbeddingModelProfile,
  resolveServerProfile,
} from "@adapters/settings";

export function requireChatModelProfile(
  settings: IxplorerSettings,
  profileId?: string,
): ChatModelProfile {
  const profile = resolveChatModelProfile(settings, profileId);
  if (!profile) {
    throw new Error("Select a chat model profile before asking a question.");
  }
  return profile;
}

export function requireEmbeddingModelProfile(
  settings: IxplorerSettings,
  profileId?: string,
): EmbeddingModelProfile {
  const profile = resolveEmbeddingModelProfile(settings, profileId);
  if (!profile) {
    throw new Error("Select an embedding model profile before using this index.");
  }
  return profile;
}

export function requireServerProfile(settings: IxplorerSettings, profileId: string): ServerProfile {
  const profile = resolveServerProfile(settings, profileId);
  if (!profile) {
    throw new Error("The selected server profile is unavailable.");
  }
  return profile;
}

export function resolveIndexProfileForUse(
  settings: IxplorerSettings,
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
    throw new Error("Index this profile before using it in chat or search.");
  }

  return requested ?? firstIndexed!;
}

export function requireIndexProfile(settings: IxplorerSettings, profileId: string): IndexProfile {
  const profile = settings.indexProfiles.find((candidate) => candidate.id === profileId);
  if (!profile || profile.isSuspended) {
    throw new Error("The selected index profile is unavailable.");
  }
  return profile;
}

export function indexSearchEmbedderWarning(
  settings: IxplorerSettings,
  indexProfileId: string,
): string | undefined {
  const indexProfile = settings.indexProfiles.find((profile) => profile.id === indexProfileId);
  if (!indexProfile) {
    return "Select an indexed profile in Ixplorer settings before searching.";
  }

  const embeddingProfile = settings.embeddingModelProfiles.find(
    (profile) => profile.id === indexProfile.embeddingModelProfileId,
  );
  if (!embeddingProfile) {
    return "The selected index's embedding model profile is unavailable. Update it in Ixplorer settings.";
  }
  if (embeddingProfile.isSuspended) {
    return "The selected index's embedding model profile is suspended. Update it in Ixplorer settings.";
  }
  if (embeddingProfile.capabilities?.embeddings === false) {
    return "The selected index's embedding model cannot create embeddings. Update it in Ixplorer settings.";
  }

  const serverProfile = resolveServerProfile(settings, embeddingProfile.serverProfileId);
  if (!serverProfile || serverProfile.isSuspended) {
    return "The selected index's embedding server is unavailable. Update it in Ixplorer settings.";
  }

  return undefined;
}
