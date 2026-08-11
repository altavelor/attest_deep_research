import type { WebQueryLanguage } from "./queryContext";

export type WebSourceCategory =
  "serp" | "neural" | "academic" | "encyclopedia" | "community" | "news" | "fetch" | "image";

export interface WebSourceCapabilities {
  search: boolean;
  fetchPage: boolean;

  images?: boolean;
}

export interface WebSourceCredentialField {
  key: string;
  label: string;

  secret: boolean;

  optional?: boolean;
  placeholder?: string;
}

export interface WebSourceDescriptor {
  id: string;
  label: string;
  category: WebSourceCategory;

  strengths: string[];
  credentials: WebSourceCredentialField[];
  homepage: string;

  freeTierNote: string;

  capabilities?: WebSourceCapabilities;

  languages?: readonly WebQueryLanguage[];
}

export const WEB_SOURCE_ACTIVATIONS = ["off", "auto", "always"] as const;

export type WebSourceActivation = (typeof WEB_SOURCE_ACTIVATIONS)[number];

export function isWebSourceActivation(value: unknown): value is WebSourceActivation {
  return typeof value === "string" && (WEB_SOURCE_ACTIVATIONS as readonly string[]).includes(value);
}

export interface WebSourceProfile {
  sourceId: string;
  activation: WebSourceActivation;
  credentials: Record<string, string>;

  imageSearchEnabled?: boolean;
}

/** True when the user has not switched the source off. */
export function isWebSourceActive(
  profile: Pick<WebSourceProfile, "activation"> | undefined,
): boolean {
  return profile !== undefined && profile.activation !== "off";
}

const apiKey = (overrides: Partial<WebSourceCredentialField> = {}): WebSourceCredentialField => ({
  key: "apiKey",
  label: "API key",
  secret: true,
  ...overrides,
});

export const WIKIMEDIA_COMMONS_SOURCE_ID = "wikimedia-commons";
export const OPENVERSE_SOURCE_ID = "openverse";

export const DUCKDUCKGO_DESCRIPTOR: WebSourceDescriptor = {
  id: "duckduckgo",
  label: "DuckDuckGo",
  category: "serp",
  strengths: ["general"],
  credentials: [],
  homepage: "https://duckduckgo.com/",
  freeTierNote: "Free, no key",
};

export const WEB_SOURCE_CATALOG: readonly WebSourceDescriptor[] = [
  DUCKDUCKGO_DESCRIPTOR,
  {
    id: "brave",
    label: "Brave Search",
    category: "serp",
    strengths: ["general", "fresh"],
    credentials: [apiKey()],
    homepage: "https://brave.com/search/api/",
    freeTierNote: "2,000 queries/month free",
    capabilities: { search: true, fetchPage: false, images: true },
  },
  {
    id: "google-cse",
    label: "Google Programmable Search",
    category: "serp",
    strengths: ["general"],
    credentials: [apiKey(), { key: "engineId", label: "Search engine ID (cx)", secret: false }],
    homepage: "https://programmablesearchengine.google.com/",
    freeTierNote: "100 queries/day free",
    capabilities: { search: true, fetchPage: false, images: true },
  },
  {
    id: "serper",
    label: "Serper.dev",
    category: "serp",
    strengths: ["general", "fresh"],
    credentials: [apiKey()],
    homepage: "https://serper.dev/",
    freeTierNote: "2,500 queries free",
    capabilities: { search: true, fetchPage: false, images: true },
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
    capabilities: { search: true, fetchPage: false, images: true },
  },
  {
    id: "tavily",
    label: "Tavily",
    category: "neural",
    strengths: ["general", "thinking", "citations"],
    credentials: [apiKey()],
    homepage: "https://tavily.com/",
    freeTierNote: "1,000 credits/month free",
  },
  {
    id: "exa",
    label: "Exa",
    category: "neural",
    strengths: ["general", "semantic", "similarity"],
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
  {
    id: "wikipedia",
    label: "Wikipedia",
    category: "encyclopedia",
    strengths: ["facts", "definitions", "overview"],
    credentials: [],
    homepage: "https://www.mediawiki.org/wiki/API:Search",
    freeTierNote: "Free, no key",
  },
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
  {
    id: "newsapi",
    label: "NewsAPI.org",
    category: "news",
    strengths: ["news", "fresh"],
    credentials: [apiKey()],
    homepage: "https://newsapi.org/",
    freeTierNote: "100 req/day free (dev tier)",
  },
  {
    id: WIKIMEDIA_COMMONS_SOURCE_ID,
    label: "Wikimedia Commons",
    category: "image",
    strengths: ["images", "reference", "public-domain"],
    credentials: [],
    homepage: "https://commons.wikimedia.org/",
    freeTierNote: "Free, no key · used only by image search",
    capabilities: { search: false, fetchPage: false },
  },
  {
    id: OPENVERSE_SOURCE_ID,
    label: "Openverse",
    category: "image",
    strengths: ["images", "openly-licensed"],
    credentials: [apiKey({ optional: true, label: "Client token (optional, raises limits)" })],
    homepage: "https://openverse.org/",
    freeTierNote: "Free, key optional · used only by image search",
    capabilities: { search: false, fetchPage: false },
  },
];

export const IMAGE_SOURCE_IDS: readonly string[] = [
  WIKIMEDIA_COMMONS_SOURCE_ID,
  OPENVERSE_SOURCE_ID,
];

export function isImageSourceId(id: string): boolean {
  return IMAGE_SOURCE_IDS.includes(id);
}

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
