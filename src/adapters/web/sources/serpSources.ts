// SERP source definitions: Brave, Google Programmable Search, Serper, SearXNG.

import {
  asArray,
  asRecord,
  asString,
  ParsedWebResult,
  requireDescriptor as descriptor,
  WebSourceDefinition,
  WebSourceQueryInput,
} from "./types";

/** Brave/Serper/SearXNG freshness codes share the day/week/month shape. */
const BRAVE_FRESHNESS = { day: "pd", week: "pw", month: "pm" } as const;
const SERPER_TBS = { day: "qdr:d", week: "qdr:w", month: "qdr:m" } as const;

export const braveDefinition: WebSourceDefinition = {
  descriptor: descriptor("brave"),
  supportsSiteOperator: true,
  buildRequest: ({ query, limit, credentials, recency }) => ({
    url:
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}` +
      (recency ? `&freshness=${BRAVE_FRESHNESS[recency]}` : ""),
    headers: {
      accept: "application/json",
      "x-subscription-token": credentials.apiKey ?? "",
    },
  }),
  parseResponse: (body) => {
    const web = asRecord(asRecord(JSON.parse(body)).web);
    return asArray(web.results).map((entry) => {
      const item = asRecord(entry);
      return {
        title: asString(item.title),
        url: asString(item.url),
        snippet: asString(item.description),
      };
    });
  },
};

export const googleCseDefinition: WebSourceDefinition = {
  descriptor: descriptor("google-cse"),
  supportsSiteOperator: true,
  buildRequest: ({ query, limit, credentials, recency }) => {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", credentials.apiKey ?? "");
    url.searchParams.set("cx", credentials.engineId ?? "");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(limit, 10)));
    if (recency) {
      url.searchParams.set("dateRestrict", { day: "d1", week: "w1", month: "m1" }[recency]);
    }
    return { url: url.toString(), headers: { accept: "application/json" } };
  },
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).items).map((entry) => {
      const item = asRecord(entry);
      return {
        title: asString(item.title),
        url: asString(item.link),
        snippet: asString(item.snippet),
      };
    }),
};

export const serperDefinition: WebSourceDefinition = {
  descriptor: descriptor("serper"),
  supportsSiteOperator: true,
  buildRequest: ({ query, limit, credentials, recency }) => ({
    url: "https://google.serper.dev/search",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": credentials.apiKey ?? "",
    },
    body: JSON.stringify({
      q: query,
      num: limit,
      ...(recency ? { tbs: SERPER_TBS[recency] } : {}),
    }),
  }),
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).organic).map((entry) => {
      const item = asRecord(entry);
      return {
        title: asString(item.title),
        url: asString(item.link),
        snippet: asString(item.snippet),
      };
    }),
};

export const searxngDefinition: WebSourceDefinition = {
  descriptor: descriptor("searxng"),
  supportsSiteOperator: true,
  buildRequest: ({ query, credentials, recency }: WebSourceQueryInput) => {
    const base = (credentials.baseUrl ?? "").replace(/\/+$/, "");
    return {
      url:
        `${base}/search?q=${encodeURIComponent(query)}&format=json` +
        (recency ? `&time_range=${recency}` : ""),
      headers: { accept: "application/json" },
    };
  },
  parseResponse: (body): ParsedWebResult[] =>
    asArray(asRecord(JSON.parse(body)).results).map((entry) => {
      const item = asRecord(entry);
      return {
        title: asString(item.title),
        url: asString(item.url),
        snippet: asString(item.content),
      };
    }),
};
