// Image endpoints of the general search engines the user has already configured
// for text search. Declarative like the text-source definitions: how to build
// the request, and how to turn an untrusted payload into neutral candidates.
//
// These engines return no licence metadata, so every candidate stays a page
// reference — it is attributed to the page that hosts it and is never presented
// as licensed content.

import {
  clampText,
  hasDisplayableDimensions,
  ImageCandidate,
  imageFormatFromPath,
} from "@core/media";
import { list, positiveNumber, record, text } from "./imageSourceHttp";

export interface ImageSourceRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export interface ImageSourceQueryInput {
  query: string;
  limit: number;
  credentials: Record<string, string>;
}

export interface ImageSourceDefinition {
  /** Catalog id of the engine that also serves this image endpoint. */
  sourceId: string;
  buildRequest(input: ImageSourceQueryInput): ImageSourceRequest;
  parseResponse(payload: unknown, sourceLabel: string): ImageCandidate[];
}

export const braveImageDefinition: ImageSourceDefinition = {
  sourceId: "brave",
  buildRequest: ({ query, limit, credentials }) => ({
    url: `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=${limit}&safesearch=strict`,
    headers: { "x-subscription-token": credentials.apiKey ?? "" },
  }),
  parseResponse: (payload, sourceLabel) =>
    list(record(payload).results).flatMap((entry) => {
      const item = record(entry);
      const properties = record(item.properties);
      return toCandidate({
        idPrefix: "brave",
        fullUrl: text(properties.url) ?? text(item.url),
        thumbnailUrl: text(record(item.thumbnail).src),
        pageUrl: text(item.url),
        title: text(item.title),
        siteLabel: text(item.source),
        sourceLabel,
        width: positiveNumber(record(item.properties).width),
        height: positiveNumber(record(item.properties).height),
      });
    }),
};

export const googleCseImageDefinition: ImageSourceDefinition = {
  sourceId: "google-cse",
  buildRequest: ({ query, limit, credentials }) => {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", credentials.apiKey ?? "");
    url.searchParams.set("cx", credentials.engineId ?? "");
    url.searchParams.set("q", query);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("safe", "active");
    url.searchParams.set("num", String(Math.min(limit, 10)));
    return { url: url.toString() };
  },
  parseResponse: (payload, sourceLabel) =>
    list(record(payload).items).flatMap((entry) => {
      const item = record(entry);
      const image = record(item.image);
      return toCandidate({
        idPrefix: "google-cse",
        fullUrl: text(item.link),
        thumbnailUrl: text(image.thumbnailLink),
        pageUrl: text(image.contextLink),
        title: text(item.title),
        siteLabel: text(item.displayLink),
        sourceLabel,
        width: positiveNumber(image.width),
        height: positiveNumber(image.height),
      });
    }),
};

export const serperImageDefinition: ImageSourceDefinition = {
  sourceId: "serper",
  buildRequest: ({ query, limit, credentials }) => ({
    url: "https://google.serper.dev/images",
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": credentials.apiKey ?? "" },
    body: JSON.stringify({ q: query, num: limit }),
  }),
  parseResponse: (payload, sourceLabel) =>
    list(record(payload).images).flatMap((entry) => {
      const item = record(entry);
      return toCandidate({
        idPrefix: "serper",
        fullUrl: text(item.imageUrl),
        thumbnailUrl: text(item.thumbnailUrl),
        pageUrl: text(item.link),
        title: text(item.title),
        siteLabel: text(item.source),
        sourceLabel,
        width: positiveNumber(item.imageWidth),
        height: positiveNumber(item.imageHeight),
      });
    }),
};

export const searxngImageDefinition: ImageSourceDefinition = {
  sourceId: "searxng",
  buildRequest: ({ query, credentials }) => ({
    url: `${(credentials.baseUrl ?? "").replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=images`,
  }),
  parseResponse: (payload, sourceLabel) =>
    list(record(payload).results).flatMap((entry) => {
      const item = record(entry);
      return toCandidate({
        idPrefix: "searxng",
        fullUrl: text(item.img_src),
        thumbnailUrl: text(item.thumbnail_src),
        pageUrl: text(item.url),
        title: text(item.title),
        siteLabel: text(item.engine),
        sourceLabel,
        width: positiveNumber(item.img_width),
        height: positiveNumber(item.img_height),
      });
    }),
};

export const IMAGE_SOURCE_DEFINITIONS: readonly ImageSourceDefinition[] = [
  braveImageDefinition,
  googleCseImageDefinition,
  serperImageDefinition,
  searxngImageDefinition,
];

interface CandidateInput {
  idPrefix: string;
  fullUrl?: string;
  thumbnailUrl?: string;
  pageUrl?: string;
  title?: string;
  siteLabel?: string;
  sourceLabel: string;
  width?: number;
  height?: number;
}

/**
 * Builds a page-reference candidate, dropping entries without a usable image
 * URL, hosting page, or displayable size. URL and format policy is applied later
 * by `toAnswerImage`, so nothing unsafe can survive to the UI.
 */
function toCandidate(input: CandidateInput): ImageCandidate[] {
  if (!input.fullUrl || !input.pageUrl) return [];
  if (!hasDisplayableDimensions(input.width, input.height)) return [];

  const title = clampText(input.title, 200) ?? "Image from a search result";
  const site = clampText(input.siteLabel, 80) ?? hostOf(input.pageUrl);
  return [
    {
      id: `${input.idPrefix}:${input.fullUrl}`,
      origin: "provider",
      ...(imageFormatFromPath(input.fullUrl)
        ? { format: imageFormatFromPath(input.fullUrl)! }
        : {}),
      ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
      fullUrl: input.fullUrl,
      alt: title,
      caption: title,
      sourceUrl: input.pageUrl,
      sourceLabel: site ? `${site} · via ${input.sourceLabel}` : input.sourceLabel,
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
    },
  ];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}
