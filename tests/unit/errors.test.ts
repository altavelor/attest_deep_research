import {
  IxplorerError,
  errorCodeFromUnknown,
  isIxplorerError,
  toUserMessage,
} from "@core/errors";

describe("Ixplorer errors", () => {
  it("maps recoverable errors to stable user-facing messages", () => {
    expect(toUserMessage(new IxplorerError({ code: "INVALID_SETTINGS" }))).toBe(
      "Check Ixplorer settings and try again.",
    );
    expect(toUserMessage(new IxplorerError({ code: "MODEL_PROVIDER_UNAVAILABLE" }))).toBe(
      "The local model provider is unavailable.",
    );
    expect(toUserMessage(new IxplorerError({ code: "INDEX_REBUILD_REQUIRED" }))).toBe(
      "The local search index needs to be rebuilt.",
    );
    expect(toUserMessage(new IxplorerError({ code: "WEB_SEARCH_DISABLED" }))).toBe(
      "Web search is disabled in Ixplorer settings.",
    );
  });

  it("shows the provider error when a model request fails", () => {
    const error = new IxplorerError({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      message: "Provider returned HTTP 401.",
      details: {
        status: 401,
        providerCode: "invalid_api_key",
        providerMessage: "The API key is invalid or expired.",
      },
    });

    expect(toUserMessage(error)).toBe(
      "Provider returned HTTP 401: The API key is invalid or expired.",
    );
  });

  it("shows the underlying cause when a model request has no provider response", () => {
    const error = new IxplorerError({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      cause: new TypeError("fetch failed"),
    });

    expect(toUserMessage(error)).toBe("fetch failed");
  });

  it("does not expose internal error messages to users", () => {
    const error = new IxplorerError({
      code: "EXTRACTION_FAILED",
      message: "pdf.js threw while reading /private/vault/secret.pdf",
    });

    expect(error.message).toBe("pdf.js threw while reading /private/vault/secret.pdf");
    expect(toUserMessage(error)).toBe("Ixplorer could not read this file.");
  });

  it("exposes actionable capability validation messages", () => {
    const error = new IxplorerError({
      code: "UNSUPPORTED_CAPABILITY",
      message: "Responses capability detection has not completed for this model profile.",
    });

    expect(toUserMessage(error)).toBe(
      "Responses capability detection has not completed for this model profile.",
    );
  });

  it("classifies unknown errors without throwing", () => {
    expect(toUserMessage(new Error("network stack details"))).toBe(
      "Something went wrong in Ixplorer.",
    );
    expect(errorCodeFromUnknown(new Error("network stack details"))).toBe("UNKNOWN");
  });

  it("preserves structured diagnostic context for internal handling", () => {
    const cause = new Error("connection refused");
    const error = new IxplorerError({
      code: "MODEL_PROVIDER_UNAVAILABLE",
      cause,
      details: { providerBaseUrl: "http://localhost:1234/v1" },
    });

    expect(isIxplorerError(error)).toBe(true);
    expect(error.code).toBe("MODEL_PROVIDER_UNAVAILABLE");
    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({ providerBaseUrl: "http://localhost:1234/v1" });
  });
});
