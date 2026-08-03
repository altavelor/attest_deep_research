import {
  PageFetchProvider,
  SearchProvider,
  SearchProviderResult,
  WebDocumentFetchResult,
  WebPageFetchOptions,
  WebPageFetchResult,
  WebPageMetadataResult,
  WebSearchOptions,
} from "@application/ports";

export interface FetchFallbackChainOptions {
  primary: SearchProvider;
  fallbacks: PageFetchProvider[];

  onFallback?(providerId: string, failure: WebPageFetchResult): void;
}

export class FetchFallbackChain implements SearchProvider {
  constructor(private readonly options: FetchFallbackChainOptions) {}

  search(query: string, options?: WebSearchOptions): Promise<SearchProviderResult[]> {
    return this.options.primary.search(query, options);
  }

  async fetchPage(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult> {
    let lastFailure: WebPageFetchResult | undefined;

    if (this.options.primary.fetchPage) {
      const result = await this.options.primary.fetchPage(url, options);
      if (result.ok) {
        return result;
      }
      this.options.onFallback?.("primary", result);
      lastFailure = result;
    }

    for (const provider of this.options.fallbacks) {
      const result = await provider.fetchPage(url, options);
      if (result.ok) {
        return result;
      }
      this.options.onFallback?.(provider.id, result);
      lastFailure = result;
    }

    return (
      lastFailure ?? {
        ok: false,
        error: {
          code: "web-fetch-unavailable",
          message: "No page-fetch provider is configured.",
          retryable: false,
        },
      }
    );
  }

  async fetchMetadata(url: string, options?: WebPageFetchOptions): Promise<WebPageMetadataResult> {
    if (!this.options.primary.fetchMetadata) {
      return unavailable();
    }
    return this.options.primary.fetchMetadata(url, options);
  }

  async fetchDocument(url: string, options?: WebPageFetchOptions): Promise<WebDocumentFetchResult> {
    if (!this.options.primary.fetchDocument) {
      return unavailable();
    }
    return this.options.primary.fetchDocument(url, options);
  }
}

function unavailable(): { ok: false; error: { code: string; message: string; retryable: false } } {
  return {
    ok: false,
    error: {
      code: "web-fetch-unavailable",
      message: "No page-fetch provider is configured.",
      retryable: false,
    },
  };
}
