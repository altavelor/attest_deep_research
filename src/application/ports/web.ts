// Application ports: web search / fetch contracts (stage 1, task 1.3).

import { WebSourceReference } from "@core/model";
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
  /** Caller-supplied query category; overrides the planner's own classification. */
  intent?: WebQueryIntent;
  /** Freshness window; sources map it to their native date filters. */
  recency?: WebQueryRecency;
  /** Query language; the planner fills it in so sources can localize requests. */
  language?: WebQueryLanguage;
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

/** Raw bytes of a downloadable document (PDF etc.), fetched for storage — not text extraction. */
export interface WebDocumentFetchSuccess {
  ok: true;
  url: string;
  finalUrl: string;
  data: Uint8Array;
  contentType: string;
  /** Raw Content-Disposition header, when present — used to recover a human-readable filename. */
  contentDisposition?: string;
  bytes: number;
  redirects: string[];
}

export type WebDocumentFetchResult = WebDocumentFetchSuccess | WebPageFetchFailure;

export interface SearchProvider {
  search(query: string, options?: WebSearchOptions): Promise<SearchProviderResult[]>;
  fetchPage?(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult>;
  /** Fetch only head metadata (title/OG/author/published) without page text. */
  fetchMetadata?(url: string, options?: WebPageFetchOptions): Promise<WebPageMetadataResult>;
  /** Fetch raw document bytes (PDF and similar) for on-demand storage in the vault. */
  fetchDocument?(url: string, options?: WebPageFetchOptions): Promise<WebDocumentFetchResult>;
}

/** A hub source: a search provider carrying its catalog descriptor for planner routing. */
export interface WebSearchSource extends SearchProvider {
  descriptor: WebSourceDescriptor;
}

/** Port for the query planner (later stage): enabled, ready-to-call hub sources. */
export interface WebSourceRegistry {
  enabledSources(): WebSearchSource[];
}

/** A single link in the page-fetch fallback chain (Jina reader, Zyte, Wayback…). */
export interface PageFetchProvider {
  id: string;
  fetchPage(url: string, options?: WebPageFetchOptions): Promise<WebPageFetchResult>;
}
