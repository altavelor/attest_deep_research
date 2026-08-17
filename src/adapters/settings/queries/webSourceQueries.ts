import { areCredentialsComplete, findWebSourceDescriptor, WebSourceProfile } from "@core/web";
import { AttestSettings } from "../types";

/** Returns the stored profile or a switched-off blank; never mutates settings. */
export function getWebSourceProfile(
  settings: Pick<AttestSettings, "webSources">,
  sourceId: string,
): WebSourceProfile {
  return (
    settings.webSources.find((profile) => profile.sourceId === sourceId) ?? {
      sourceId,
      activation: "off",
      credentials: {},
    }
  );
}

/** Replaces (or appends) the profile for its sourceId. */
export function upsertWebSourceProfile(
  settings: Pick<AttestSettings, "webSources">,
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
  settings: Pick<AttestSettings, "webSources">,
  sourceId: string,
): boolean {
  const descriptor = findWebSourceDescriptor(sourceId);
  if (!descriptor) {
    return false;
  }
  return areCredentialsComplete(descriptor, getWebSourceProfile(settings, sourceId).credentials);
}
