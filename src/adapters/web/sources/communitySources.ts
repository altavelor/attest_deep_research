// Developer/community and news definitions: GitHub, Stack Exchange,
// Hacker News (Algolia), NewsAPI.

import {
  asArray,
  asRecord,
  asString,
  requireDescriptor as descriptor,
  WebSourceDefinition,
} from "./types";

export const githubDefinition: WebSourceDefinition = {
  descriptor: descriptor("github"),
  buildRequest: ({ query, limit, credentials }) => ({
    url:
      "https://api.github.com/search/repositories?q=" +
      encodeURIComponent(query) +
      `&per_page=${limit}`,
    headers: {
      accept: "application/vnd.github+json",
      ...(credentials.apiKey ? { authorization: `Bearer ${credentials.apiKey}` } : {}),
    },
  }),
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).items).map((entry) => {
      const item = asRecord(entry);
      const stars = typeof item.stargazers_count === "number" ? ` ★${item.stargazers_count}` : "";
      return {
        title: asString(item.full_name) + stars,
        url: asString(item.html_url),
        snippet: asString(item.description),
      };
    }),
};

export const stackExchangeDefinition: WebSourceDefinition = {
  descriptor: descriptor("stackexchange"),
  buildRequest: ({ query, limit, credentials }) => {
    const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
    url.searchParams.set("q", query);
    url.searchParams.set("site", "stackoverflow");
    url.searchParams.set("order", "desc");
    url.searchParams.set("sort", "relevance");
    url.searchParams.set("pagesize", String(limit));
    if (credentials.apiKey) {
      url.searchParams.set("key", credentials.apiKey);
    }
    return { url: url.toString(), headers: { accept: "application/json" } };
  },
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).items).map((entry) => {
      const item = asRecord(entry);
      const answers = typeof item.answer_count === "number" ? item.answer_count : 0;
      const accepted = item.is_answered === true ? "accepted answer" : "no accepted answer";
      return {
        title: decodeHtmlEntities(asString(item.title)),
        url: asString(item.link),
        snippet: `${answers} answers · ${accepted} · score ${asString(String(item.score ?? 0))}`,
      };
    }),
};

export const hackerNewsDefinition: WebSourceDefinition = {
  descriptor: descriptor("hackernews"),
  buildRequest: ({ query, limit, freshFrom }) => {
    const endpoint = freshFrom ? "search_by_date" : "search";
    const numericFilters = freshFrom
      ? `&numericFilters=${encodeURIComponent(
          `created_at_i>${Math.floor(Date.parse(freshFrom) / 1_000)}`,
        )}`
      : "";
    return {
      url:
        `https://hn.algolia.com/api/v1/${endpoint}?query=` +
        encodeURIComponent(query) +
        `&tags=story&hitsPerPage=${limit}` +
        numericFilters,
      headers: { accept: "application/json" },
    };
  },
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).hits).map((entry) => {
      const item = asRecord(entry);
      const objectId = asString(item.objectID);
      const discussion = `https://news.ycombinator.com/item?id=${objectId}`;
      const points = typeof item.points === "number" ? item.points : 0;
      const comments = typeof item.num_comments === "number" ? item.num_comments : 0;
      const created = asString(item.created_at).slice(0, 10);
      return {
        title: asString(item.title),
        url: asString(item.url) || discussion,
        snippet: [created, `${points} points · ${comments} comments`, discussion]
          .filter(Boolean)
          .join(" · "),
      };
    }),
};

export const newsApiDefinition: WebSourceDefinition = {
  descriptor: descriptor("newsapi"),
  buildRequest: ({ query, limit, credentials, freshFrom, language, domains }) => {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query);
    url.searchParams.set("pageSize", String(limit));
    url.searchParams.set("sortBy", freshFrom ? "publishedAt" : "relevancy");
    if (freshFrom) {
      url.searchParams.set("from", freshFrom);
    }
    if (language) {
      url.searchParams.set("language", language);
    }
    if (domains && domains.length > 0) {
      url.searchParams.set("domains", domains.join(","));
    }
    return {
      url: url.toString(),
      headers: {
        accept: "application/json",
        "x-api-key": credentials.apiKey ?? "",
      },
    };
  },
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).articles).map((entry) => {
      const item = asRecord(entry);
      const sourceName = asString(asRecord(item.source).name);
      const published = asString(item.publishedAt).slice(0, 10);
      return {
        title: asString(item.title),
        url: asString(item.url),
        snippet: [asString(item.description), sourceName, published].filter(Boolean).join(" · "),
      };
    }),
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
