// Academic and encyclopedia definitions: arXiv, Semantic Scholar, OpenAlex,
// Europe PMC, Wikipedia. All are free JSON APIs except arXiv (Atom XML).

import {
  asArray,
  asRecord,
  asString,
  ParsedWebResult,
  requireDescriptor as descriptor,
  WebSourceDefinition,
} from "./types";

export const arxivDefinition: WebSourceDefinition = {
  descriptor: descriptor("arxiv"),
  buildRequest: ({ query, limit }) => ({
    url:
      "https://export.arxiv.org/api/query?search_query=" +
      encodeURIComponent(`all:${query}`) +
      `&start=0&max_results=${limit}`,
    headers: { accept: "application/atom+xml" },
  }),
  parseResponse: (body) => parseArxivAtom(body),
};

/** Minimal Atom parsing via regex: vitest runs in node (no DOMParser), and the feed shape is stable. */
function parseArxivAtom(xml: string): ParsedWebResult[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.map((entry) => ({
    title: decodeXmlEntities(tagText(entry, "title")).replace(/\s+/g, " "),
    url: tagText(entry, "id"),
    snippet: decodeXmlEntities(tagText(entry, "summary")).replace(/\s+/g, " ").slice(0, 300),
  }));
}

function tagText(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() ?? "";
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export const semanticScholarDefinition: WebSourceDefinition = {
  descriptor: descriptor("semantic-scholar"),
  buildRequest: ({ query, limit, credentials }) => ({
    url:
      "https://api.semanticscholar.org/graph/v1/paper/search?query=" +
      encodeURIComponent(query) +
      `&limit=${limit}&fields=title,abstract,url,year`,
    headers: {
      accept: "application/json",
      ...(credentials.apiKey ? { "x-api-key": credentials.apiKey } : {}),
    },
  }),
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).data).map((entry) => {
      const item = asRecord(entry);
      const year = typeof item.year === "number" ? ` (${item.year})` : "";
      return {
        title: asString(item.title) + year,
        url: asString(item.url),
        snippet: asString(item.abstract).slice(0, 300),
      };
    }),
};

export const openAlexDefinition: WebSourceDefinition = {
  descriptor: descriptor("openalex"),
  buildRequest: ({ query, limit }) => ({
    url:
      "https://api.openalex.org/works?search=" +
      encodeURIComponent(query) +
      `&per-page=${limit}`,
    headers: { accept: "application/json" },
  }),
  parseResponse: (body) =>
    asArray(asRecord(JSON.parse(body)).results).map((entry) => {
      const item = asRecord(entry);
      const primary = asRecord(item.primary_location);
      const year =
        typeof item.publication_year === "number" ? ` (${item.publication_year})` : "";
      return {
        title: asString(item.display_name) + year,
        url:
          asString(primary.landing_page_url) ||
          asString(item.doi) ||
          asString(item.id),
        snippet: asString(asRecord(primary.source).display_name),
      };
    }),
};

export const europePmcDefinition: WebSourceDefinition = {
  descriptor: descriptor("europe-pmc"),
  buildRequest: ({ query, limit }) => ({
    url:
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=" +
      encodeURIComponent(query) +
      `&format=json&pageSize=${limit}`,
    headers: { accept: "application/json" },
  }),
  parseResponse: (body) => {
    const resultList = asRecord(asRecord(JSON.parse(body)).resultList);
    return asArray(resultList.result).map((entry) => {
      const item = asRecord(entry);
      const source = asString(item.source);
      const id = asString(item.id);
      return {
        title: asString(item.title),
        url:
          source && id ? `https://europepmc.org/article/${source}/${id}` : asString(item.doi),
        snippet: [asString(item.authorString), asString(item.journalTitle), asString(item.pubYear)]
          .filter(Boolean)
          .join(" · "),
      };
    });
  },
};

export const wikipediaDefinition: WebSourceDefinition = {
  descriptor: descriptor("wikipedia"),
  buildRequest: ({ query, limit, language }) => {
    const url = new URL(`https://${language === "ru" ? "ru" : "en"}.wikipedia.org/w/api.php`);
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "search");
    url.searchParams.set("srsearch", query);
    url.searchParams.set("srlimit", String(limit));
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    return { url: url.toString(), headers: { accept: "application/json" } };
  },
  parseResponse: (body, input) => {
    const host = input.language === "ru" ? "ru.wikipedia.org" : "en.wikipedia.org";
    return asArray(asRecord(asRecord(JSON.parse(body)).query).search).map((entry) => {
      const item = asRecord(entry);
      const title = asString(item.title);
      return {
        title,
        url: `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        snippet: stripSearchHighlights(asString(item.snippet)),
      };
    });
  },
};

/** MediaWiki wraps matches in <span class="searchmatch">…</span>. */
function stripSearchHighlights(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
