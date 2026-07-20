// Jina Reader (r.jina.ai): fetches a URL as LLM-ready markdown. First fallback
// in the page-fetch chain — handles JS-rendered pages the native fetcher can't.

import { PageFetchProvider, WebPageFetchOptions, WebPageFetchResult } from "@application/ports";
import {
  FetchHttpRuntime,
  DEFAULT_MAX_CONTENT_CHARS,
  fetchFailure,
  requestText,
} from "./fetchHttp";

export class JinaReaderFetchProvider implements PageFetchProvider {
  readonly id = "jina";

  constructor(
    private readonly apiKey: string,
    private readonly runtime: FetchHttpRuntime = {},
  ) {}

  async fetchPage(url: string, options: WebPageFetchOptions = {}): Promise<WebPageFetchResult> {
    const response = await requestText(
      {
        url: `https://r.jina.ai/${url}`,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
      },
      this.runtime,
      options.timeoutMs,
    );
    if (!response.ok) {
      return response.result;
    }

    let content = "";
    let finalUrl = url;
    try {
      const payload = JSON.parse(response.text) as {
        data?: { content?: unknown; url?: unknown };
      };
      content = typeof payload.data?.content === "string" ? payload.data.content.trim() : "";
      finalUrl = typeof payload.data?.url === "string" ? payload.data.url : url;
    } catch {
      return fetchFailure(
        "web-fetch-bad-response",
        "Jina Reader returned an unexpected response.",
        false,
      );
    }
    if (!content) {
      return fetchFailure("web-fetch-empty-content", "Page contained no readable text.", false);
    }

    const maxChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
    return {
      ok: true,
      url,
      finalUrl,
      content: content.slice(0, maxChars),
      contentType: "text/markdown",
      bytes: response.text.length,
      truncated: content.length > maxChars,
      redirects: [],
    };
  }
}
