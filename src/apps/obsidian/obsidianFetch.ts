import { requestUrl } from "obsidian";

export const obsidianRequestFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw abortReason(signal);

  const request = requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: normalizeFetchHeaders(init?.headers),
    body: normalizeFetchBody(init?.body),
    throw: false,
  });

  const response = signal ? await raceAbort(request, signal) : await request;
  return new Response(response.arrayBuffer, {
    status: response.status,
    headers: response.headers,
  });
};

function raceAbort<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortError(): Error {
  const error = new Error("The request was aborted.");
  error.name = "AbortError";
  return error;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : abortError();
}

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
