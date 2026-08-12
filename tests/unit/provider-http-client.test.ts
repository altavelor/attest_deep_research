import { ProviderHttpClient } from "@adapters/model-provider/common/http";

function client(fetchImpl: typeof fetch, timeoutMs = 30_000): ProviderHttpClient {
  return new ProviderHttpClient({
    apiFormat: "openai-compatible",
    baseUrl: "https://api.example.test/v1",
    fetch: fetchImpl,
    timeoutMs,
    unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
    unavailableMessage: "Provider unavailable.",
  });
}

describe("ProviderHttpClient cancellation", () => {
  it("preserves an external abort reason instead of wrapping it as provider unavailable", async () => {
    const reason = new DOMException("Stopped by user", "AbortError");
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;
    const controller = new AbortController();
    const pending = client(fetchMock).request("/models", {
      method: "GET",
      signal: controller.signal,
    });

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("keeps timeout failures in the stable provider error taxonomy", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }) as typeof fetch;
      const pending = client(fetchMock, 25).request("/models", { method: "GET" });
      const assertion = expect(pending).rejects.toMatchObject({
        code: "MODEL_PROVIDER_UNAVAILABLE",
      });

      await vi.advanceTimersByTimeAsync(25);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
