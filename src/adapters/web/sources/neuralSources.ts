import {
  asArray,
  asRecord,
  asString,
  requireDescriptor as descriptor,
  WebSourceDefinition,
} from "./types";

const MAX_EXTRACTED_TEXT_LENGTH = 12_000;

function boundedText(value: unknown): string | undefined {
  const text = asString(value).trim();
  return text ? text.slice(0, MAX_EXTRACTED_TEXT_LENGTH) : undefined;
}

export const tavilyDefinition: WebSourceDefinition = {
  descriptor: descriptor("tavily"),
  buildRequest: ({ query, limit, credentials, recency }) => ({
    url: "https://api.tavily.com/search",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.apiKey ?? ""}`,
    },
    body: JSON.stringify({
      query,
      max_results: limit,
      include_answer: false,
      ...(recency ? { time_range: recency } : {}),
    }),
  }),
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).results).map((entry) => {
      const item = asRecord(entry);
      const content = boundedText(item.content);
      return {
        title: asString(item.title),
        url: asString(item.url),
        snippet: asString(item.content).slice(0, 300),
        ...(content ? { extractedText: content } : {}),
      };
    }),
};

export const exaDefinition: WebSourceDefinition = {
  descriptor: descriptor("exa"),
  buildRequest: ({ query, limit, credentials }) => ({
    url: "https://api.exa.ai/search",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": credentials.apiKey ?? "",
    },
    body: JSON.stringify({ query, numResults: limit, contents: { text: true } }),
  }),
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).results).map((entry) => {
      const item = asRecord(entry);
      const text = boundedText(item.text);
      return {
        title: asString(item.title),
        url: asString(item.url),
        snippet: asString(item.text).slice(0, 300),
        ...(text ? { extractedText: text } : {}),
      };
    }),
};

export const jinaDefinition: WebSourceDefinition = {
  descriptor: descriptor("jina"),
  buildRequest: ({ query, credentials }) => ({
    url: `https://s.jina.ai/?q=${encodeURIComponent(query)}`,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${credentials.apiKey ?? ""}`,
      "x-respond-with": "no-content",
    },
  }),
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).data).map((entry) => {
      const item = asRecord(entry);
      const content = boundedText(item.content);
      return {
        title: asString(item.title),
        url: asString(item.url),
        snippet: asString(item.description),
        ...(content ? { extractedText: content } : {}),
      };
    }),
};

export const firecrawlDefinition: WebSourceDefinition = {
  descriptor: descriptor("firecrawl"),
  buildRequest: ({ query, limit, credentials }) => ({
    url: "https://api.firecrawl.dev/v1/search",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credentials.apiKey ?? ""}`,
    },
    body: JSON.stringify({ query, limit }),
  }),
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).data).map((entry) => {
      const item = asRecord(entry);
      const markdown = boundedText(item.markdown);
      return {
        title: asString(item.title),
        url: asString(item.url),
        snippet: asString(item.description),
        ...(markdown ? { extractedText: markdown } : {}),
      };
    }),
};
