import { PluginDebugLogger } from "@adapters/settings";
import {
  createFetchFallbackProviders,
  createWebSearchSources,
  DuckDuckGoSearchProvider,
} from "@adapters/web";
import type { SearchProvider, WebSearchSource } from "@application/ports";
import {
  FetchFallbackChain,
  WebQueryIntentClassifier,
  WebQueryPlanner,
  WebSourceHealthTracker,
} from "@application/web";
import { obsidianRequestFetch } from "@apps/obsidian/obsidianFetch";
import { DUCKDUCKGO_DESCRIPTOR, isWebSourceActive } from "@core/web";
import { IxplorerSettings } from "@adapters/settings";

export interface WebSearchFactoryOptions {
  settings: IxplorerSettings;
  logger: PluginDebugLogger;
  health: WebSourceHealthTracker;

  intentClassifier?: WebQueryIntentClassifier;
}

/** Creates the research web-search planner and its page-fetch fallback chain. */
export function createWebSearchProvider(
  options: WebSearchFactoryOptions,
): SearchProvider | undefined {
  const runtime = {
    fetch: obsidianRequestFetch,
    logger: options.logger,
  };
  const duckDuckGoProfile = options.settings.webSources.find(
    (profile) => profile.sourceId === DUCKDUCKGO_DESCRIPTOR.id,
  );
  const duckDuckGo = new DuckDuckGoSearchProvider(runtime);
  const hubSources = createWebSearchSources(options.settings.webSources, runtime);
  const pool: WebSearchSource[] = [
    ...(isWebSourceActive(duckDuckGoProfile)
      ? [
          Object.assign(duckDuckGo, {
            descriptor: DUCKDUCKGO_DESCRIPTOR,
            activation: duckDuckGoProfile?.activation ?? "auto",
          }),
        ]
      : []),
    ...hubSources,
  ];
  if (pool.length === 0) return undefined;

  const fetchDelegate = new FetchFallbackChain({
    primary: duckDuckGo,
    fallbacks: createFetchFallbackProviders(options.settings.webSources, duckDuckGo, runtime),
    onFallback: (providerId, failure) =>
      options.logger.logError(failure.ok ? undefined : failure.error, {
        url: `fetch-fallback:${providerId}`,
      }),
  });

  return new WebQueryPlanner({
    registry: { enabledSources: () => pool },
    fetchDelegate,
    health: options.health,
    ...(options.intentClassifier ? { intentClassifier: options.intentClassifier } : {}),
    onSourceError: (sourceId, error) =>
      options.logger.logError(error, { url: `source:${sourceId}` }),
  });
}
