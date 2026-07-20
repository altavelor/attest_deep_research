// Core domain: static catalog of external web search sources.
// Platform-neutral metadata only — endpoints and parsing live in adapters/web.

import type { WebQueryLanguage } from "./queryContext";

export type WebSourceCategory =
  | "serp"
  | "neural"
  | "academic"
  | "encyclopedia"
  | "community"
  | "news"
  | "fetch";

/** What the source can do; absent means search-only. */
export interface WebSourceCapabilities {
  search: boolean;
  fetchPage: boolean;
}

/** Declarative credential field; drives settings UI generation and enable-gating. */
export interface WebSourceCredentialField {
  key: string;
  label: string;
  /** Masked in UI (API keys). Base URLs and engine ids are not secret. */
  secret: boolean;
  /** Optional credentials raise limits but are not required to enable the source. */
  optional?: boolean;
  placeholder?: string;
}

export interface WebSourceDescriptor {
  id: string;
  label: string;
  category: WebSourceCategory;
  /** Query-planner hints: what this source is strong at. */
  strengths: string[];
  credentials: WebSourceCredentialField[];
  homepage: string;
  /** Short free-tier note shown in settings. */
  freeTierNote: string;
  /** Absent ⇒ search-only. */
  capabilities?: WebSourceCapabilities;
  /** Query languages this source can answer; absent ⇒ any language. */
  languages?: readonly WebQueryLanguage[];
}

/** Per-source user configuration persisted in settings. */
export interface WebSourceProfile {
  sourceId: string;
  enabled: boolean;
  credentials: Record<string, string>;
}

const apiKey = (overrides: Partial<WebSourceCredentialField> = {}): WebSourceCredentialField => ({
  key: "apiKey",
  label: "API key",
  secret: true,
  ...overrides,
});

/** Built-in scraper provider; lives in the catalog like any other source but is constructed specially. */
export const DUCKDUCKGO_DESCRIPTOR: WebSourceDescriptor = {
  id: "duckduckgo",
  label: "DuckDuckGo",
  category: "serp",
  strengths: ["general"],
  credentials: [],
  homepage: "https://duckduckgo.com/",
  freeTierNote: "Free, no key",
};

/**
 * Sources selectable in settings, in planner-preference order within category.
 */
export const WEB_SOURCE_CATALOG: readonly WebSourceDescriptor[] = [
  // --- General SERP ---
  DUCKDUCKGO_DESCRIPTOR,
  {
    id: "brave",
    label: "Brave Search",
    category: "serp",
    strengths: ["general", "fresh"],
    credentials: [apiKey()],
    homepage: "https://brave.com/search/api/",
    freeTierNote: "2,000 queries/month free",
  },
  {
    id: "google-cse",
    label: "Google Programmable Search",
    category: "serp",
    strengths: ["general"],
    credentials: [apiKey(), { key: "engineId", label: "Search engine ID (cx)", secret: false }],
    homepage: "https://programmablesearchengine.google.com/",
    freeTierNote: "100 queries/day free",
  },
  {
    id: "serper",
    label: "Serper.dev",
    category: "serp",
    strengths: ["general", "fresh"],
    credentials: [apiKey()],
    homepage: "https://serper.dev/",
    freeTierNote: "2,500 queries free",
  },
  {
    id: "searxng",
    label: "SearXNG (self-hosted)",
    category: "serp",
    strengths: ["general", "privacy"],
    credentials: [
      {
        key: "baseUrl",
        label: "Instance URL",
        secret: false,
        placeholder: "https://searx.example.org",
      },
    ],
    homepage: "https://docs.searxng.org/",
    freeTierNote: "Free (own instance; JSON format must be enabled)",
  },
  // --- LLM-oriented / neural ---
  {
    id: "tavily",
    label: "Tavily",
    category: "neural",
    strengths: ["general", "agentic", "citations"],
    credentials: [apiKey()],
    homepage: "https://tavily.com/",
    freeTierNote: "1,000 credits/month free",
  },
  {
    id: "exa",
    label: "Exa",
    category: "neural",
    strengths: ["semantic", "similarity"],
    credentials: [apiKey()],
    homepage: "https://exa.ai/",
    freeTierNote: "~1,000 searches/month free",
  },
  {
    id: "jina",
    label: "Jina Search",
    category: "neural",
    strengths: ["general", "reader"],
    credentials: [apiKey()],
    homepage: "https://jina.ai/",
    freeTierNote: "Free token allowance on signup",
    capabilities: { search: true, fetchPage: true },
  },
  {
    id: "firecrawl",
    label: "Firecrawl Search",
    category: "neural",
    strengths: ["general", "scrape"],
    credentials: [apiKey()],
    homepage: "https://firecrawl.dev/",
    freeTierNote: "Free tier credits",
  },
  // --- Academic ---
  {
    id: "arxiv",
    label: "arXiv",
    category: "academic",
    strengths: ["papers", "preprints", "cs", "physics", "math"],
    credentials: [],
    homepage: "https://info.arxiv.org/help/api/",
    freeTierNote: "Free, no key",
    languages: ["en"],
  },
  {
    id: "semantic-scholar",
    label: "Semantic Scholar",
    category: "academic",
    strengths: ["papers", "citations-graph"],
    credentials: [apiKey({ optional: true, label: "API key (optional, raises limits)" })],
    homepage: "https://www.semanticscholar.org/product/api",
    freeTierNote: "Free, key optional",
    languages: ["en"],
  },
  {
    id: "openalex",
    label: "OpenAlex",
    category: "academic",
    strengths: ["papers", "metadata"],
    credentials: [],
    homepage: "https://docs.openalex.org/",
    freeTierNote: "Free, no key",
    languages: ["en"],
  },
  {
    id: "europe-pmc",
    label: "Europe PMC",
    category: "academic",
    strengths: ["papers", "biomed"],
    credentials: [],
    homepage: "https://europepmc.org/RestfulWebService",
    freeTierNote: "Free, no key",
    languages: ["en"],
  },
  // --- Encyclopedia ---
  {
    id: "wikipedia",
    label: "Wikipedia",
    category: "encyclopedia",
    strengths: ["facts", "definitions", "overview"],
    credentials: [],
    homepage: "https://www.mediawiki.org/wiki/API:Search",
    freeTierNote: "Free, no key",
  },
  // --- Developer / community ---
  {
    id: "github",
    label: "GitHub",
    category: "community",
    strengths: ["code", "repositories", "issues"],
    credentials: [apiKey({ optional: true, label: "Token (optional, raises limits)" })],
    homepage: "https://docs.github.com/rest/search",
    freeTierNote: "Free; 10 req/min without token",
    languages: ["en"],
  },
  {
    id: "stackexchange",
    label: "Stack Exchange",
    category: "community",
    strengths: ["code", "qa", "troubleshooting"],
    credentials: [apiKey({ optional: true, label: "App key (optional, raises quota)" })],
    homepage: "https://api.stackexchange.com/",
    freeTierNote: "Free; 300 req/day without key",
    languages: ["en"],
  },
  {
    id: "hackernews",
    label: "Hacker News (Algolia)",
    category: "community",
    strengths: ["tech-news", "discussions"],
    credentials: [],
    homepage: "https://hn.algolia.com/api",
    freeTierNote: "Free, no key",
    languages: ["en"],
  },
  // --- Page fetching ---
  {
    id: "zyte",
    label: "Zyte API",
    category: "fetch",
    strengths: [],
    credentials: [apiKey()],
    homepage: "https://www.zyte.com/zyte-api/",
    freeTierNote: "Pay-as-you-go ($5 trial credit); used as a page-fetch fallback",
    capabilities: { search: false, fetchPage: true },
  },
  // --- News ---
  {
    id: "newsapi",
    label: "NewsAPI.org",
    category: "news",
    strengths: ["news", "fresh"],
    credentials: [apiKey()],
    homepage: "https://newsapi.org/",
    freeTierNote: "100 req/day free (dev tier)",
  },
];

export function findWebSourceDescriptor(id: string): WebSourceDescriptor | undefined {
  return WEB_SOURCE_CATALOG.find((descriptor) => descriptor.id === id);
}

/** True when every non-optional credential field has a non-empty value. */
export function areCredentialsComplete(
  descriptor: WebSourceDescriptor,
  credentials: Record<string, string> | undefined,
): boolean {
  return descriptor.credentials.every(
    (field) => field.optional === true || Boolean(credentials?.[field.key]?.trim()),
  );
}
