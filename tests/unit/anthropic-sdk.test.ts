import { APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import {
  createLoggingFetch,
  normalizeAnthropicBaseUrl,
  translateAnthropicError,
} from "@adapters/model-provider/chat/providers/anthropicSdk";
import { AttestError } from "@core/errors";

describe("Anthropic SDK adapter", () => {
  it("normalizes stored versioned base URLs", () => {
    expect(normalizeAnthropicBaseUrl(" https://api.example.com/v1/ ")).toBe(
      "https://api.example.com",
    );
    expect(normalizeAnthropicBaseUrl("https://api.example.com/custom/v2")).toBe(
      "https://api.example.com/custom",
    );
  });

  it("logs provider requests while removing a missing API-key header", async () => {
    const baseFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-api-key")).toBeNull();
      return new Response("ok", { status: 201, statusText: "Created" });
    });
    const logger = { logRequest: vi.fn(), logResponse: vi.fn() };
    const fetchWithLogging = createLoggingFetch(baseFetch as never, {
      logger: logger as never,
      stripHeader: "X-API-Key",
    });

    const response = await fetchWithLogging("https://api.example.com/v1/messages", {
      method: "post",
      headers: { "X-API-Key": "missing", "x-client": "attest" },
    });

    expect(response.status).toBe(201);
    expect(baseFetch).toHaveBeenCalledWith(
      "https://api.example.com/v1/messages",
      expect.objectContaining({ method: "post" }),
    );
    expect(logger.logRequest).toHaveBeenCalledWith(expect.objectContaining({ method: "POST" }));
    expect(logger.logResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 201, statusText: "Created" }),
    );
  });

  it("maps Anthropic API failures into safe plugin errors and preserves cancellation", () => {
    const notFound = new APIError(
      404,
      { type: "not_found_error", error: { message: "model key-secret unavailable" } },
      "Not found",
      new Headers(),
    );
    const missing = translateAnthropicError(notFound, {
      unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
      unavailableMessage: "Unavailable",
      apiKey: "key-secret",
    });
    expect(missing).toMatchObject({
      code: "MODEL_NOT_FOUND",
      details: {
        status: 404,
        providerCode: "not_found_error",
        providerMessage: "model [redacted] unavailable",
      },
    });

    const unavailable = translateAnthropicError(
      new APIError(429, {}, "Rate limit", new Headers()),
      {
        unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
        unavailableMessage: "Unavailable",
      },
    );
    expect(unavailable).toMatchObject({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      details: { status: 429 },
    });
    expect(
      translateAnthropicError(new Error("offline"), {
        unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
        unavailableMessage: "Unavailable",
      }),
    ).toMatchObject({ code: "MODEL_PROVIDER_UNAVAILABLE", message: "Unavailable" });
    const alreadyMapped = new AttestError({ code: "MODEL_NOT_FOUND" });
    expect(
      translateAnthropicError(alreadyMapped, {
        unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
        unavailableMessage: "Unavailable",
      }),
    ).toBe(alreadyMapped);
    expect(() =>
      translateAnthropicError(new APIUserAbortError(), {
        unavailableCode: "MODEL_PROVIDER_UNAVAILABLE",
        unavailableMessage: "Unavailable",
      }),
    ).toThrow(APIUserAbortError);
  });
});
