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

export const braveDefinition: WebSourceDefinition = {
  descriptor: descriptor("brave"),
  buildRequest: ({ query, limit, credentials }) => ({
    url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
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
  buildRequest: ({ query, limit, credentials }) => {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", credentials.apiKey ?? "");
    url.searchParams.set("cx", credentials.engineId ?? "");
    url.searchParams.set("q", query);
    // CSE caps `num` at 10.
    url.searchParams.set("num", String(Math.min(limit, 10)));
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
  buildRequest: ({ query, limit, credentials }) => ({
    url: "https://google.serper.dev/search",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": credentials.apiKey ?? "",
    },
    body: JSON.stringify({ q: query, num: limit }),
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
  buildRequest: ({ query, credentials }: WebSourceQueryInput) => {
    const base = (credentials.baseUrl ?? "").replace(/\/+$/, "");
    return {
      url: `${base}/search?q=${encodeURIComponent(query)}&format=json`,
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
