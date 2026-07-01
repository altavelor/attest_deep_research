// Application ports: web search / fetch contracts (stage 1, task 1.3).

import { WebSourceReference } from "@core/model";
import { ToolError } from "@core/agent";

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
}

export interface WebPageFetchOptions {
  timeoutMs?: number;
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
}

export interface WebPageFetchFailure {
  ok: false;
  error: ToolError;
}

export type WebPageFetchResult = WebPageFetchSuccess | WebPageFetchFailure;

/** Lightweight page metadata for source triage, parsed from the raw HTML head. */
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

export interface SearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<SearchProviderResult[]>;
  fetchPage?(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult>;
  /** Fetch only head metadata (title/OG/author/published) without page text. */
  fetchMetadata?(url: string, options?: WebPageFetchOptions): Promise<WebPageMetadataResult>;
}
