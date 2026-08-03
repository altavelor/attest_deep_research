import {
  PageFetchProvider,
  SearchProvider,
  WebPageFetchOptions,
  WebPageFetchResult,
} from "@application/ports";
import { FetchHttpRuntime, fetchFailure, requestText } from "./fetchHttp";

export class WaybackFetchProvider implements PageFetchProvider {
  readonly id = "wayback";

  constructor(
    private readonly pageFetcher: Pick<SearchProvider, "fetchPage">,
    private readonly runtime: FetchHttpRuntime = {},
  ) {}

  async fetchPage(url: string, options: WebPageFetchOptions = {}): Promise<WebPageFetchResult> {
    const response = await requestText(
      { url: `https://archive.org/wayback/available?url=${encodeURIComponent(url)}` },
      this.runtime,
      options.timeoutMs,
    );
    if (!response.ok) {
      return response.result;
    }

    let snapshotUrl = "";
    try {
      const payload = JSON.parse(response.text) as {
        archived_snapshots?: { closest?: { available?: unknown; url?: unknown } };
      };
      const closest = payload.archived_snapshots?.closest;
      if (closest?.available === true && typeof closest.url === "string") {
        snapshotUrl = closest.url.replace(/^http:\/\//, "https://");
      }
    } catch {
      return fetchFailure(
        "web-fetch-bad-response",
        "Wayback returned an unexpected response.",
        false,
      );
    }
    if (!snapshotUrl) {
      return fetchFailure("web-fetch-no-snapshot", "No archived snapshot is available.", false);
    }

    if (!this.pageFetcher.fetchPage) {
      return fetchFailure("web-fetch-unavailable", "No page-fetch provider is configured.", false);
    }
    return this.pageFetcher.fetchPage(snapshotUrl, options);
  }
}
