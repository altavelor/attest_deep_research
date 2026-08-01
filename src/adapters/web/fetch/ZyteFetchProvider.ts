// Zyte API (api.zyte.com/v1/extract): industrial fetcher with browser rendering
// and antibot handling. Second fallback in the page-fetch chain.

import { PageFetchProvider, WebPageFetchOptions, WebPageFetchResult } from "@application/ports";
import { extractReadableText } from "../DuckDuckGoParser";
import {
  FetchHttpRuntime,
  DEFAULT_MAX_CONTENT_CHARS,
  fetchFailure,
  requestText,
} from "./fetchHttp";

export class ZyteFetchProvider implements PageFetchProvider {
  readonly id = "zyte";

  constructor(
    private readonly apiKey: string,
    private readonly runtime: FetchHttpRuntime = {},
  ) {}

  async fetchPage(url: string, options: WebPageFetchOptions = {}): Promise<WebPageFetchResult> {
    const response = await requestText(
      {
        url: "https://api.zyte.com/v1/extract",
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${toBase64(`${this.apiKey}:`)}`,
        },
        body: JSON.stringify({ url, browserHtml: true }),
      },
      this.runtime,
      options.timeoutMs,
    );
    if (!response.ok) {
      return response.result;
    }

    let html = "";
    let finalUrl = url;
    try {
      const payload = JSON.parse(response.text) as { browserHtml?: unknown; url?: unknown };
      html = typeof payload.browserHtml === "string" ? payload.browserHtml : "";
      finalUrl = typeof payload.url === "string" ? payload.url : url;
    } catch {
      return fetchFailure("web-fetch-bad-response", "Zyte returned an unexpected response.", false);
    }

    const maxChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
    const extracted = extractReadableText(html, maxChars + 1);
    if (!extracted) {
      return fetchFailure("web-fetch-empty-content", "Page contained no readable text.", false);
    }
    return {
      ok: true,
      url,
      finalUrl,
      content: extracted.slice(0, maxChars),
      contentType: "text/html",
      bytes: html.length,
      truncated: extracted.length > maxChars,
      redirects: [],
    };
  }
}

function toBase64(value: string): string {
  return typeof btoa === "function" ? btoa(value) : Buffer.from(value, "utf8").toString("base64");
}
