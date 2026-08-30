import {
  UrlStatusChecker,
  UrlStatusCheckRequest,
  UrlStatusCheckResult,
} from "@application/contracts";
import { validatePublicWebUrl } from "@application/sources";
import { fetchTransportOrUnavailable, scheduleTimeout } from "@shared";

export interface FetchUrlStatusCheckerOptions {
  fetch?: typeof fetch;
}

export class FetchUrlStatusChecker implements UrlStatusChecker {
  private readonly fetchImpl: typeof fetch;

  constructor(options: FetchUrlStatusCheckerOptions = {}) {
    this.fetchImpl = fetchTransportOrUnavailable(options.fetch);
  }

  async checkUrls(
    urls: UrlStatusCheckRequest[],
    options: { timeoutMs: number; signal: AbortSignal },
  ): Promise<UrlStatusCheckResult[]> {
    return checkWithConcurrency(this.fetchImpl, urls, options, 8);
  }
}

async function checkWithConcurrency(
  fetchImpl: typeof fetch,
  urls: UrlStatusCheckRequest[],
  options: { timeoutMs: number; signal: AbortSignal },
  concurrency: number,
): Promise<UrlStatusCheckResult[]> {
  const results: Array<UrlStatusCheckResult | undefined> = Array.from(
    { length: urls.length },
    () => undefined,
  );
  let next = 0;

  async function worker(): Promise<void> {
    while (next < urls.length && !options.signal.aborted) {
      const index = next;
      next += 1;
      results[index] = await checkUrl(fetchImpl, urls[index].url, options);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return results.filter((result): result is UrlStatusCheckResult => result !== undefined);
}

async function checkUrl(
  fetchImpl: typeof fetch,
  rawUrl: string,
  options: { timeoutMs: number; signal: AbortSignal },
): Promise<UrlStatusCheckResult> {
  const validated = validatePublicWebUrl(rawUrl);
  if (!validated.ok) {
    return { url: rawUrl, state: "unreachable", ok: false, error: validated.reason };
  }

  const controller = new AbortController();
  const timeout = scheduleTimeout(() => controller.abort(), options.timeoutMs);
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });

  try {
    let response = await fetchImpl(validated.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: requestHeaders(),
    });
    if (response.status === 405) {
      response = await fetchImpl(validated.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { ...requestHeaders(), Range: "bytes=0-0" },
      });
    }
    return {
      url: validated.url,
      state: stateFromResponse(response),
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || validated.url,
    };
  } catch (error) {
    return {
      url: validated.url,
      state: "unknown",
      ok: false,
      error: error instanceof Error ? error.name : "fetch-failed",
    };
  } finally {
    timeout.cancel();
    options.signal.removeEventListener("abort", abort);
  }
}

function requestHeaders(): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "user-agent": "Mozilla/5.0 (compatible; AttestLinkChecker/1.0; +https://obsidian.md)",
  };
}

function stateFromResponse(response: Response): UrlStatusCheckResult["state"] {
  if (response.ok) {
    return "reachable";
  }
  if (response.status === 404 || response.status === 410) {
    return "unreachable";
  }
  return "unknown";
}
