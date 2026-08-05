import { WebSourceReference } from "@core/model";
import type { ImageCandidate } from "@core/media";
import { ToolError } from "@core/agent";
import type {
  WebQueryIntent,
  WebQueryLanguage,
  WebQueryRecency,
  WebSourceDescriptor,
} from "@core/web";

export interface SearchProviderResult {
  source: WebSourceReference;
  extractedText?: string;
  rank: number;
  query: string;
}

export interface WebSearchOptions {
  limit?: number;
  maxFetches?: number;
  timeoutMs?: number;

  signal?: AbortSignal;

  intent?: WebQueryIntent;

  recency?: WebQueryRecency;

  language?: WebQueryLanguage;
}

export interface WebPageFetchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxResponseBytes?: number;
  maxContentChars?: number;
  maxRedirects?: number;
}

export interface WebPageFetchSuccess {
  ok: true;
  url: string;
  finalUrl: string;
  content: string;
  contentType: string;
  bytes: number;
  truncated: boolean;
  redirects: string[];

  pageImages?: ImageCandidate[];
}

export interface WebPageFetchFailure {
  ok: false;
  error: ToolError;
}

export type WebPageFetchResult = WebPageFetchSuccess | WebPageFetchFailure;

export interface WebPageMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  author?: string;
  publishedTime?: string;
  language?: string;
  canonicalUrl?: string;
}

export interface WebPageMetadataSuccess {
  ok: true;
  url: string;
  finalUrl: string;
  metadata: WebPageMetadata;
}

export type WebPageMetadataResult = WebPageMetadataSuccess | WebPageFetchFailure;

export interface WebDocumentFetchSuccess {
  ok: true;
  url: string;
  finalUrl: string;
  data: Uint8Array;
  contentType: string;

  contentDisposition?: string;
  bytes: number;
  redirects: string[];
}

export type WebDocumentFetchResult = WebDocumentFetchSuccess | WebPageFetchFailure;

export interface SearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<SearchProviderResult[]>;

  searchSourceLabels?(query: string, options?: WebSearchOptions): readonly string[];
  fetchPage?(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult>;

  fetchMetadata?(url: string, options?: WebPageFetchOptions): Promise<WebPageMetadataResult>;

  fetchDocument?(url: string, options?: WebPageFetchOptions): Promise<WebDocumentFetchResult>;
}

export interface WebSearchSource extends SearchProvider {
  descriptor: WebSourceDescriptor;
}

export interface WebSourceRegistry {
  enabledSources(): WebSearchSource[];
}

export interface PageFetchProvider {
  id: string;
  fetchPage(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult>;
}
