// Pure queries/updates for web-source hub profiles stored in settings.

import { areCredentialsComplete, findWebSourceDescriptor, WebSourceProfile } from "@core/web";
import { IxplorerSettings } from "./types";

/** Returns the stored profile or a disabled blank; never mutates settings. */
export function getWebSourceProfile(
  settings: Pick<IxplorerSettings, "webSources">,
  sourceId: string,
): WebSourceProfile {
  return (
    settings.webSources.find((profile) => profile.sourceId === sourceId) ?? {
      sourceId,
      enabled: false,
      credentials: {},
    }
  );
}

/** Replaces (or appends) the profile for its sourceId. */
export function upsertWebSourceProfile(
  settings: Pick<IxplorerSettings, "webSources">,
  profile: WebSourceProfile,
): void {
  const index = settings.webSources.findIndex((entry) => entry.sourceId === profile.sourceId);
  if (index >= 0) {
    settings.webSources[index] = profile;
  } else {
    settings.webSources.push(profile);
  }
}

/** True when the source's required credentials are filled in. */
export function isWebSourceConfigured(
  settings: Pick<IxplorerSettings, "webSources">,
  sourceId: string,
): boolean {
  const descriptor = findWebSourceDescriptor(sourceId);
  if (!descriptor) {
    return false;
  }
  return areCredentialsComplete(descriptor, getWebSourceProfile(settings, sourceId).credentials);
}
