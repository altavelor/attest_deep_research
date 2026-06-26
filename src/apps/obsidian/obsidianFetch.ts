import { requestUrl } from "obsidian";

/** A `fetch`-compatible function backed by Obsidian's `requestUrl` (bypasses CORS). */
export const obsidianRequestFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const response = await requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: normalizeFetchHeaders(init?.headers),
    body: normalizeFetchBody(init?.body),
    throw: false,
  });

  return new Response(response.arrayBuffer, {
    status: response.status,
    headers: response.headers,
  });
};

function normalizeFetchHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const entries: Record<string, string> = {};
    headers.forEach((value, key) => {
      entries[key] = value;
    });
    return entries;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

function normalizeFetchBody(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
  if (typeof body === "string" || body instanceof ArrayBuffer) {
    return body;
  }

  return undefined;
}
