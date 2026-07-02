// Builds the ordered page-fetch fallback list (Jina → Zyte → Wayback) from the
// user's web-source profiles. Jina and Zyte join only when their profile is
// enabled and holds a key; Wayback is free and always closes the chain.

import { areCredentialsComplete, findWebSourceDescriptor, WebSourceProfile } from "@core/web";
import { PageFetchProvider, SearchProvider } from "@application/ports";
import { FetchHttpRuntime } from "./fetchHttp";
import { JinaReaderFetchProvider } from "./JinaReaderFetchProvider";
import { WaybackFetchProvider } from "./WaybackFetchProvider";
import { ZyteFetchProvider } from "./ZyteFetchProvider";

export function createFetchFallbackProviders(
  profiles: readonly WebSourceProfile[],
  snapshotPageFetcher: Pick<SearchProvider, "fetchPage">,
  runtime: FetchHttpRuntime = {},
): PageFetchProvider[] {
  const providers: PageFetchProvider[] = [];

  const jinaKey = enabledApiKey(profiles, "jina");
  if (jinaKey) {
    providers.push(new JinaReaderFetchProvider(jinaKey, runtime));
  }
  const zyteKey = enabledApiKey(profiles, "zyte");
  if (zyteKey) {
    providers.push(new ZyteFetchProvider(zyteKey, runtime));
  }
  providers.push(new WaybackFetchProvider(snapshotPageFetcher, runtime));

  return providers;
}

function enabledApiKey(
  profiles: readonly WebSourceProfile[],
  sourceId: string,
): string | undefined {
  const descriptor = findWebSourceDescriptor(sourceId);
  const profile = profiles.find((entry) => entry.sourceId === sourceId);
  if (!descriptor || !profile?.enabled) {
    return undefined;
  }
  if (!areCredentialsComplete(descriptor, profile.credentials)) {
    return undefined;
  }
  return profile.credentials.apiKey?.trim() || undefined;
}
