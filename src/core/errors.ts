export type AttestErrorCode =
  | "INVALID_SETTINGS"
  | "MODEL_PROVIDER_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "UNSUPPORTED_CAPABILITY"
  | "EMBEDDING_UNAVAILABLE"
  | "INDEX_UNAVAILABLE"
  | "INDEX_REBUILD_REQUIRED"
  | "EXTRACTION_FAILED"
  | "CONTEXT_WINDOW_EXCEEDED"
  | "INVALID_SKILL_SELECTION"
  | "SKILL_TOO_LARGE"
  | "WEB_SEARCH_DISABLED"
  | "WEB_SEARCH_FAILED"
  | "UNKNOWN";

const USER_MESSAGES: Record<AttestErrorCode, string> = {
  INVALID_SETTINGS: "Check Attest settings and try again.",
  MODEL_PROVIDER_UNAVAILABLE: "The local model provider is unavailable.",
  MODEL_NOT_FOUND: "The configured model is not available.",
  UNSUPPORTED_CAPABILITY: "The selected model does not support this capability.",
  EMBEDDING_UNAVAILABLE: "The embedding provider is unavailable.",
  INDEX_UNAVAILABLE: "The local search index is unavailable.",
  INDEX_REBUILD_REQUIRED: "The local search index needs to be rebuilt.",
  EXTRACTION_FAILED: "Attest could not read this file.",
  CONTEXT_WINDOW_EXCEEDED: "The current chat is too long for the selected model context window.",
  INVALID_SKILL_SELECTION: "Select exactly one valid Attest skill and try again.",
  SKILL_TOO_LARGE: "The selected skill is too large for the current model context window.",
  WEB_SEARCH_DISABLED: "Web search is disabled in Attest settings.",
  WEB_SEARCH_FAILED: "Web search failed.",
  UNKNOWN: "Something went wrong in Attest.",
};

export interface AttestErrorOptions {
  code: AttestErrorCode;
  message?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AttestError extends Error {
  readonly code: AttestErrorCode;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(options: AttestErrorOptions) {
    super(options.message ?? USER_MESSAGES[options.code]);
    this.name = "AttestError";
    this.code = options.code;
    this.cause = options.cause;
    this.details = options.details;
  }
}

export function isAttestError(error: unknown): error is AttestError {
  return error instanceof AttestError;
}

export function toUserMessage(error: unknown): string {
  if (isAttestError(error)) {
    if (error.code === "UNSUPPORTED_CAPABILITY" || error.code === "INVALID_SETTINGS") {
      return error.message;
    }
    if (error.code === "MODEL_PROVIDER_UNAVAILABLE" || error.code === "MODEL_NOT_FOUND") {
      return modelRequestUserMessage(error);
    }
    return USER_MESSAGES[error.code];
  }

  return USER_MESSAGES.UNKNOWN;
}

function modelRequestUserMessage(error: AttestError): string {
  const providerMessage = detailMessage(error.details?.providerMessage);
  if (providerMessage) {
    const status = error.details?.status;
    return typeof status === "number" && Number.isFinite(status)
      ? `Provider returned HTTP ${status}: ${providerMessage}`
      : providerMessage;
  }

  const causeMessage = errorMessage(error.cause);
  if (causeMessage) return causeMessage;

  return error.message !== USER_MESSAGES[error.code] ? error.message : USER_MESSAGES[error.code];
}

function detailMessage(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return detailMessage(error);
}

export function errorCodeFromUnknown(error: unknown): AttestErrorCode {
  return isAttestError(error) ? error.code : "UNKNOWN";
}
