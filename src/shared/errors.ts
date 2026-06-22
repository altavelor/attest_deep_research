export type IxplorerErrorCode =
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

const USER_MESSAGES: Record<IxplorerErrorCode, string> = {
  INVALID_SETTINGS: "Check Ixplorer settings and try again.",
  MODEL_PROVIDER_UNAVAILABLE: "The local model provider is unavailable.",
  MODEL_NOT_FOUND: "The configured model is not available.",
  UNSUPPORTED_CAPABILITY: "The selected model does not support this capability.",
  EMBEDDING_UNAVAILABLE: "The embedding provider is unavailable.",
  INDEX_UNAVAILABLE: "The local search index is unavailable.",
  INDEX_REBUILD_REQUIRED: "The local search index needs to be rebuilt.",
  EXTRACTION_FAILED: "Ixplorer could not read this file.",
  CONTEXT_WINDOW_EXCEEDED: "The current chat is too long for the selected model context window.",
  INVALID_SKILL_SELECTION: "Select exactly one valid Ixplorer skill and try again.",
  SKILL_TOO_LARGE: "The selected skill is too large for the current model context window.",
  WEB_SEARCH_DISABLED: "Web search is disabled in Ixplorer settings.",
  WEB_SEARCH_FAILED: "Web search failed.",
  UNKNOWN: "Something went wrong in Ixplorer.",
};

export interface IxplorerErrorOptions {
  code: IxplorerErrorCode;
  message?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class IxplorerError extends Error {
  readonly code: IxplorerErrorCode;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(options: IxplorerErrorOptions) {
    super(options.message ?? USER_MESSAGES[options.code]);
    this.name = "IxplorerError";
    this.code = options.code;
    this.cause = options.cause;
    this.details = options.details;
  }
}

export function isIxplorerError(error: unknown): error is IxplorerError {
  return error instanceof IxplorerError;
}

export function toUserMessage(error: unknown): string {
  if (isIxplorerError(error)) {
    if (error.code === "UNSUPPORTED_CAPABILITY") return error.message;
    return USER_MESSAGES[error.code];
  }

  return USER_MESSAGES.UNKNOWN;
}

export function errorCodeFromUnknown(error: unknown): IxplorerErrorCode {
  return isIxplorerError(error) ? error.code : "UNKNOWN";
}
