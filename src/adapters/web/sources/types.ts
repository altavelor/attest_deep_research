// Contract between the generic HTTP engine and per-source definitions.
// A definition is declarative: how to build the request and how to parse the
// response body into neutral results. All I/O lives in HttpWebSearchSource.

import {
  findWebSourceDescriptor,
  type WebQueryLanguage,
  type WebQueryRecency,
  type WebSourceDescriptor,
} from "@core/web";

export interface WebSourceQueryInput {
  query: string;
  limit: number;
  /** Values entered by the user for descriptor.credentials fields. */
  credentials: Record<string, string>;
  /** Freshness window requested by the planner. */
  recency?: WebQueryRecency;
  /** ISO instant matching `recency` — earliest acceptable publication time. */
  freshFrom?: string;
  /** Query language detected by the planner. */
  language?: WebQueryLanguage;
  /** Domains extracted from `site:` operators the source's API cannot parse. */
  domains?: string[];
}

export interface WebSourceRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/** Neutral parsed result; the engine turns it into a SearchProviderResult. */
export interface ParsedWebResult {
  title: string;
  url: string;
  snippet: string;
  /** Full text when the API already returns page content (Tavily, Exa, Jina…). */
  extractedText?: string;
}

export interface WebSourceDefinition {
  descriptor: WebSourceDescriptor;
  /**
   * True when the underlying engine understands `site:` operators in the query
   * text (SERP-style APIs). Keyword APIs get the operators stripped by the
   * engine and receive the domains via `input.domains` instead.
   */
  supportsSiteOperator?: boolean;
  buildRequest(input: WebSourceQueryInput): WebSourceRequest;
  /** Pure: parses the raw response body. Throws on malformed payloads. */
  parseResponse(body: string, input: WebSourceQueryInput): ParsedWebResult[];
}

/** Trims and drops results without a usable title or absolute http(s) URL. */
export function sanitizeParsedResults(results: ParsedWebResult[]): ParsedWebResult[] {
  return results
    .map((result) => ({
      ...result,
      title: result.title.trim(),
      url: result.url.trim(),
      snippet: result.snippet.trim(),
    }))
    .filter((result) => result.title.length > 0 && /^https?:\/\//i.test(result.url));
}

/** Looks up a catalog descriptor; definitions must never invent ids outside the catalog. */
export function requireDescriptor(id: string): WebSourceDescriptor {
  const found = findWebSourceDescriptor(id);
  if (!found) {
    throw new Error(`Web source descriptor missing from catalog: ${id}`);
  }
  return found;
}

/** Safe accessor for loosely typed JSON payloads. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
