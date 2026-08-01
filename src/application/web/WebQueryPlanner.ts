// Web query planner: routes a search across enabled hub sources based on the
// query intent, fanning out and merging with reciprocal rank fusion. Implements
// SearchProvider, so research tools consume the hub without changes. Page
// fetching is delegated to the generic fetch provider (DuckDuckGo adapter).

import {
  classifyWebQuery,
  detectQueryLanguage,
  inferQueryRecency,
  mergeRankedResults,
  selectSourcesForIntent,
} from "@core/web";
import {
  SearchProvider,
  SearchProviderResult,
  WebDocumentFetchResult,
  WebPageFetchOptions,
  WebPageFetchResult,
  WebPageMetadataResult,
  WebSearchOptions,
  WebSearchSource,
  WebSourceRegistry,
} from "@application/ports";
import { WebSourceHealthTracker } from "./WebSourceHealthTracker";

export interface WebQueryPlannerOptions {
  registry: WebSourceRegistry;
  /** Generic page fetcher; search results never come from it unless it is also in the registry. */
  fetchDelegate?: SearchProvider;
  /** Sources queried per search. */
  maxSources?: number;
  /** Called when one source fails while others still deliver. */
  onSourceError?(sourceId: string, error: unknown): void;
  /**
   * Shared health state driving auto-suspension. Pass the plugin-lifetime
   * instance so suspensions survive planner recreation; defaults to a private
   * tracker configured by the two options below.
   */
  health?: WebSourceHealthTracker;
  /** How long a rate-limited source sits out before being retried (default tracker only). */
  rateLimitCooldownMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_SOURCES = 3;

export class WebQueryPlanner implements SearchProvider {
  private readonly health: WebSourceHealthTracker;

  constructor(private readonly options: WebQueryPlannerOptions) {
    this.health =
      options.health ??
      new WebSourceHealthTracker({
        rateLimitCooldownMs: options.rateLimitCooldownMs,
        now: options.now,
      });
  }

  async search(query: string, options: WebSearchOptions = {}): Promise<SearchProviderResult[]> {
    const language = options.language ?? detectQueryLanguage(query);
    const sources = this.options.registry
      .enabledSources()
      .filter((source) => this.health.isAvailable(source.descriptor.id))
      .filter(
        (source) =>
          source.descriptor.languages === undefined ||
          source.descriptor.languages.includes(language),
      );
    if (sources.length === 0) {
      return [];
    }

    const intent = options.intent ?? classifyWebQuery(query);
    const recency = options.recency ?? inferQueryRecency(query);
    const searchOptions = {
      ...options,
      language,
      ...(recency ? { recency } : {}),
    };
    const byId = new Map(sources.map((source) => [source.descriptor.id, source]));
    const selected = selectSourcesForIntent(
      sources.map((source) => source.descriptor),
      intent,
      this.options.maxSources ?? DEFAULT_MAX_SOURCES,
    )
      .map((descriptor) => byId.get(descriptor.id))
      .filter((source): source is WebSearchSource => source !== undefined);

    const lists = await Promise.all(
      selected.map(async (source) => {
        try {
          const results = await source.search(query, searchOptions);
          this.health.reportSuccess(source.descriptor.id);
          return results;
        } catch (error) {
          this.health.reportFailure(source.descriptor.id, error);
          this.options.onSourceError?.(source.descriptor.id, error);
          return [] as SearchProviderResult[];
        }
      }),
    );

    const merged = mergeRankedResults(lists, (result) => result.source.url);
    const limit = options.limit ?? merged.length;
    return merged.slice(0, limit).map((result, index) => ({ ...result, rank: index + 1 }));
  }

  async fetchPage(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult> {
    const delegate = this.requireFetchDelegate();
    if (!delegate?.fetchPage) {
      return fetchUnavailable();
    }
    return delegate.fetchPage(url, options);
  }

  async fetchMetadata(url: string, options?: WebPageFetchOptions): Promise<WebPageMetadataResult> {
    const delegate = this.requireFetchDelegate();
    if (!delegate?.fetchMetadata) {
      return fetchUnavailable();
    }
    return delegate.fetchMetadata(url, options);
  }

  async fetchDocument(url: string, options?: WebPageFetchOptions): Promise<WebDocumentFetchResult> {
    const delegate = this.requireFetchDelegate();
    if (!delegate?.fetchDocument) {
      return fetchUnavailable();
    }
    return delegate.fetchDocument(url, options);
  }

  private requireFetchDelegate(): SearchProvider | undefined {
    return this.options.fetchDelegate;
  }
}

function fetchUnavailable(): {
  ok: false;
  error: { code: string; message: string; retryable: false };
} {
  return {
    ok: false,
    error: {
      code: "web-fetch-unavailable",
      message: "No page-fetch provider is configured.",
      retryable: false,
    },
  };
}
