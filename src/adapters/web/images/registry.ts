import { OPENVERSE_SOURCE_ID, WIKIMEDIA_COMMONS_SOURCE_ID } from "@core/web";
import { areCredentialsComplete, findWebSourceDescriptor, WebSourceProfile } from "@core/web";
import type { ImageSearchRegistry, ImageSearchSource } from "@application/ports";
import { IMAGE_SOURCE_DEFINITIONS } from "./engineDefinitions";
import { HttpImageSearchSource } from "./HttpImageSearchSource";
import { OpenverseImageSource } from "./OpenverseImageSource";
import { WikimediaCommonsImageSource } from "./WikimediaCommonsImageSource";
import type { ImageSourceHttpOptions } from "./imageSourceHttp";

export function createImageSearchSources(
  profiles: readonly WebSourceProfile[],
  runtime: ImageSourceHttpOptions = {},
): ImageSearchSource[] {
  const byId = new Map(profiles.map((profile) => [profile.sourceId, profile]));
  const sources: ImageSearchSource[] = [];

  const usable = (sourceId: string) => {
    const descriptor = findWebSourceDescriptor(sourceId);
    const profile = byId.get(sourceId);
    if (!descriptor || !profile?.enabled) return undefined;
    return areCredentialsComplete(descriptor, profile.credentials)
      ? { descriptor, credentials: profile.credentials }
      : undefined;
  };

  const commons = usable(WIKIMEDIA_COMMONS_SOURCE_ID);
  if (commons) sources.push(new WikimediaCommonsImageSource(commons.descriptor, runtime));

  const openverse = usable(OPENVERSE_SOURCE_ID);
  if (openverse) {
    sources.push(new OpenverseImageSource(openverse.descriptor, openverse.credentials, runtime));
  }

  for (const definition of IMAGE_SOURCE_DEFINITIONS) {
    const engine = usable(definition.sourceId);
    if (!engine) continue;
    if (byId.get(definition.sourceId)?.imageSearchEnabled !== true) continue;
    sources.push(
      new HttpImageSearchSource(engine.descriptor, definition, engine.credentials, runtime),
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
