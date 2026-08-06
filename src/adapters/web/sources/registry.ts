import { areCredentialsComplete, isWebSourceActive, WebSourceProfile } from "@core/web";
import { WebSearchSource, WebSourceRegistry } from "@application/ports";
import {
  arxivDefinition,
  europePmcDefinition,
  openAlexDefinition,
  semanticScholarDefinition,
  wikipediaDefinition,
} from "./academicSources";
import {
  githubDefinition,
  hackerNewsDefinition,
  newsApiDefinition,
  stackExchangeDefinition,
} from "./communitySources";
import {
  exaDefinition,
  firecrawlDefinition,
  jinaDefinition,
  tavilyDefinition,
} from "./neuralSources";
import {
  braveDefinition,
  googleCseDefinition,
  searxngDefinition,
  serperDefinition,
} from "./serpSources";
import { HttpWebSearchSource, HttpWebSearchSourceOptions } from "./HttpWebSearchSource";
import { WebSourceDefinition } from "./types";

export const WEB_SOURCE_DEFINITIONS: readonly WebSourceDefinition[] = [
  braveDefinition,
  googleCseDefinition,
  serperDefinition,
  searxngDefinition,
  tavilyDefinition,
  exaDefinition,
  jinaDefinition,
  firecrawlDefinition,
  arxivDefinition,
  semanticScholarDefinition,
  openAlexDefinition,
  europePmcDefinition,
  wikipediaDefinition,
  githubDefinition,
  stackExchangeDefinition,
  hackerNewsDefinition,
  newsApiDefinition,
];

export type WebSourceRuntimeOptions = Omit<HttpWebSearchSourceOptions, "credentials">;

/**
 * Builds ready-to-call sources for profiles that are enabled AND fully
 * configured; misconfigured-but-enabled profiles are skipped defensively
 * (the settings UI should prevent that state).
 */
export function createWebSearchSources(
  profiles: readonly WebSourceProfile[],
  runtime: WebSourceRuntimeOptions = {},
): WebSearchSource[] {
  const byId = new Map(profiles.map((profile) => [profile.sourceId, profile]));

  return WEB_SOURCE_DEFINITIONS.flatMap((definition) => {
    const profile = byId.get(definition.descriptor.id);
    if (
      !profile ||
      !isWebSourceActive(profile) ||
      !areCredentialsComplete(definition.descriptor, profile.credentials)
    ) {
      return [];
    }
    return [
      new HttpWebSearchSource(definition, {
        ...runtime,
        activation: profile.activation,
        credentials: profile.credentials,
      }),
    ];
  });
}

export function createWebSourceRegistry(
  profiles: readonly WebSourceProfile[],
  runtime: WebSourceRuntimeOptions = {},
): WebSourceRegistry {
  const sources = createWebSearchSources(profiles, runtime);
  return { enabledSources: () => sources };
}
