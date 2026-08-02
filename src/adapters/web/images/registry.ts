// Builds the enabled image-search sources from the user's web-source profiles.
// Image sources are toggled independently of text search and never contribute
// to search_web ranking.

import { OPENVERSE_SOURCE_ID, WIKIMEDIA_COMMONS_SOURCE_ID } from "@core/web";
import { areCredentialsComplete, findWebSourceDescriptor, WebSourceProfile } from "@core/web";
import type { ImageSearchRegistry, ImageSearchSource } from "@application/ports";
import { OpenverseImageSource } from "./OpenverseImageSource";
import { WikimediaCommonsImageSource } from "./WikimediaCommonsImageSource";
import type { ImageSourceHttpOptions } from "./imageSourceHttp";

export function createImageSearchSources(
  profiles: readonly WebSourceProfile[],
  runtime: ImageSourceHttpOptions = {},
): ImageSearchSource[] {
  const byId = new Map(profiles.map((profile) => [profile.sourceId, profile]));
  const sources: ImageSearchSource[] = [];

  for (const sourceId of [WIKIMEDIA_COMMONS_SOURCE_ID, OPENVERSE_SOURCE_ID]) {
    const descriptor = findWebSourceDescriptor(sourceId);
    const profile = byId.get(sourceId);
    if (!descriptor || !profile?.enabled) continue;
    if (!areCredentialsComplete(descriptor, profile.credentials)) continue;

    sources.push(
      sourceId === WIKIMEDIA_COMMONS_SOURCE_ID
        ? new WikimediaCommonsImageSource(descriptor, runtime)
        : new OpenverseImageSource(descriptor, profile.credentials, runtime),
    );
  }
  return sources;
}

/** Static registry over the sources enabled when the run started. */
export class StaticImageSearchRegistry implements ImageSearchRegistry {
  constructor(private readonly sources: ImageSearchSource[]) {}

  enabledImageSources(): ImageSearchSource[] {
    return this.sources;
  }
}
