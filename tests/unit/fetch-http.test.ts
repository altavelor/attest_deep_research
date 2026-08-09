import { describe, expect, it, vi } from "vitest";

import { requestText } from "@adapters/web/fetch/fetchHttp";

describe("requestText", () => {
  it("forwards the request and records successful response metadata", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("payload", { status: 201 }));
    const logger = { logRequest: vi.fn(), logResponse: vi.fn(), logError: vi.fn() };

    await expect(
      requestText(
        {
          url: "https://api.example.test/items",
          method: "POST",
          headers: { authorization: "Bearer x" },
          body: "{}",
        },
        { fetch, logger },
      ),
    ).resolves.toEqual({ ok: true, text: "payload", status: 201 });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/items",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer x" },
        body: "{}",
      }),
    );
    expect(logger.logResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 201, method: "POST" }),
    );
  });

  it("turns failed HTTP responses into retryable or terminal fetch failures", async () => {
    const cancelled = vi.fn().mockResolvedValue(undefined);
    const overloaded = {
      ok: false,
      status: 503,
      statusText: "Unavailable",
      body: { cancel: cancelled },
    };

    await expect(
      requestText(
        { url: "https://example.test" },
        { fetch: vi.fn().mockResolvedValue(overloaded) },
      ),
    ).resolves.toMatchObject({
      ok: false,
      result: { error: { code: "web-fetch-http", retryable: true, details: { status: 503 } } },
    });
    expect(cancelled).toHaveBeenCalledOnce();

    await expect(
      requestText(
        { url: "https://example.test" },
        { fetch: vi.fn().mockResolvedValue({ ...overloaded, status: 404, body: undefined }) },
      ),
    ).resolves.toMatchObject({
      ok: false,
      result: { error: { retryable: false } },
    });
  });

  it("distinguishes aborts from network failures and logs both", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const logger = { logRequest: vi.fn(), logResponse: vi.fn(), logError: vi.fn() };

    await expect(
      requestText(
        { url: "https://example.test" },
        { fetch: vi.fn().mockRejectedValue(abort), logger },
      ),
    ).resolves.toMatchObject({
      ok: false,
      result: { error: { code: "web-fetch-timeout", retryable: true } },
    });
    await expect(
      requestText(
        { url: "https://example.test" },
        { fetch: vi.fn().mockRejectedValue("offline"), logger },
      ),
    ).resolves.toMatchObject({
      ok: false,
      result: { error: { code: "web-fetch-network", retryable: true } },
    });
    expect(logger.logError).toHaveBeenCalledTimes(2);
  });
});
