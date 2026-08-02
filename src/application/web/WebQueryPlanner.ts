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

  fetchDelegate?: SearchProvider;

  maxSources?: number;

  onSourceError?(sourceId: string, error: unknown): void;

  health?: WebSourceHealthTracker;

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
    const selected = this.selectSources(query, options);
    if (selected.length === 0) return [];

    const language = options.language ?? detectQueryLanguage(query);
    const recency = options.recency ?? inferQueryRecency(query);
    const searchOptions = {
      ...options,
      language,
      ...(recency ? { recency } : {}),
    };

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

  searchSourceLabels(query: string, options: WebSearchOptions = {}): readonly string[] {
    return this.selectSources(query, options).map((source) => source.descriptor.label);
  }

  private selectSources(query: string, options: WebSearchOptions): WebSearchSource[] {
    const language = options.language ?? detectQueryLanguage(query);
    const sources = this.options.registry
      .enabledSources()
      .filter((source) => this.health.isAvailable(source.descriptor.id))
      .filter(
        (source) =>
          source.descriptor.languages === undefined ||
          source.descriptor.languages.includes(language),
      );
    if (sources.length === 0) return [];

    const intent = options.intent ?? classifyWebQuery(query);
    const byId = new Map(sources.map((source) => [source.descriptor.id, source]));
    return selectSourcesForIntent(
      sources.map((source) => source.descriptor),
      intent,
      this.options.maxSources ?? DEFAULT_MAX_SOURCES,
    )
      .map((descriptor) => byId.get(descriptor.id))
      .filter((source): source is WebSearchSource => source !== undefined);
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
