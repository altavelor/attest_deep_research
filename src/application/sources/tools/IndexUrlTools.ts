import {
  IndexedUrlInventoryOptions,
  IndexedUrlInventoryResult,
  ResearchRetriever,
  UrlStatusChecker,
} from "../../contracts/research";
import {
  Tool as ResearchToolHandler,
  ToolContext as ResearchToolExecutionContext,
  ToolExecution as ResearchToolExecution,
  ToolParseResult as ResearchToolParseResult,
  toolFailure,
} from "../../../core/agent/tool";

interface ListIndexUrlsInput {
  cursor?: string;
  limit: number;
  sourcePath?: string;
}

interface CheckUrlsInput {
  urls: string[];
  timeoutMs: number;
}

export type ListIndexUrlsOutput = IndexedUrlInventoryResult & {
  diagnostics: {
    resultCount: number;
    limit: number;
    untrustedEvidence: true;
  };
};

export interface CheckUrlsOutput {
  results: Awaited<ReturnType<UrlStatusChecker["checkUrls"]>>;
  diagnostics: {
    checkedCount: number;
    timeoutMs: number;
  };
}

export interface ListIndexUrlsToolOptions {
  allowedSourcePaths?: readonly string[];
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_CURSOR_CHARS = 200;
const MAX_SOURCE_PATH_CHARS = 500;
const MAX_URLS_PER_CHECK = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;

export class ListIndexUrlsTool implements ResearchToolHandler<
  ListIndexUrlsInput,
  ListIndexUrlsOutput
> {
  readonly definition = {
    type: "function" as const,
    function: {
      name: "list_index_urls",
      description:
        "List URLs extracted from the selected local index, with surrounding context and purpose hints. Use this for exhaustive URL inventories; results are paginated.",
      parameters: {
        type: "object",
        properties: {
          cursor: { type: "string", maxLength: MAX_CURSOR_CHARS },
          limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
          sourcePath: { type: "string", maxLength: MAX_SOURCE_PATH_CHARS },
        },
        additionalProperties: false,
      },
    },
  };

  private readonly allowedSourcePaths: readonly string[];

  constructor(
    private readonly retriever: ResearchRetriever,
    options: ListIndexUrlsToolOptions = {},
  ) {
    this.allowedSourcePaths = options.allowedSourcePaths ?? [];
  }

  parseInput(input: Record<string, unknown>): ResearchToolParseResult<ListIndexUrlsInput> {
    const unknown = Object.keys(input).find(
      (key) => key !== "cursor" && key !== "limit" && key !== "sourcePath",
    );
    if (unknown) {
      return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
    }

    const cursor = readOptionalString(input.cursor, MAX_CURSOR_CHARS);
    if (cursor === false) {
      return toolFailure("invalid-cursor", "Cursor must be a bounded string.");
    }
    const sourcePath = readOptionalString(input.sourcePath, MAX_SOURCE_PATH_CHARS);
    if (sourcePath === false) {
      return toolFailure("invalid-source-path", "sourcePath must be a bounded string.");
    }
    const resolvedSourcePath = this.resolveSourcePath(sourcePath);
    if (!resolvedSourcePath.ok) {
      return resolvedSourcePath;
    }
    const limit = readLimit(input.limit);
    if (limit === undefined) {
      return toolFailure("invalid-limit", "Limit must be an integer.");
    }

    return {
      ok: true,
      value: {
        ...(cursor ? { cursor } : {}),
        limit,
        ...(resolvedSourcePath.value ? { sourcePath: resolvedSourcePath.value } : {}),
      },
    };
  }

  async execute(
    input: ListIndexUrlsInput,
    _context: ResearchToolExecutionContext,
  ): Promise<ResearchToolExecution<ListIndexUrlsOutput>> {
    if (!this.retriever.listIndexedUrls) {
      return toolFailure("index-url-inventory-unsupported", "The selected index cannot list URLs.");
    }

    let result: IndexedUrlInventoryResult;
    try {
      result = await this.retriever.listIndexedUrls(input satisfies IndexedUrlInventoryOptions);
    } catch {
      return toolFailure("index-url-inventory-failed", "Index URL inventory failed.", true);
    }

    return {
      ok: true,
      value: {
        items: result.items,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        diagnostics: {
          resultCount: result.items.length,
          limit: input.limit,
          untrustedEvidence: true,
        },
      },
    };
  }

  private resolveSourcePath(
    sourcePath: string | undefined,
  ): ResearchToolParseResult<string | undefined> {
    if (this.allowedSourcePaths.length === 0) {
      return { ok: true, value: sourcePath };
    }
    if (sourcePath) {
      return this.allowedSourcePaths.includes(sourcePath)
        ? { ok: true, value: sourcePath }
        : toolFailure("source-path-out-of-scope", "sourcePath is outside the attached context.");
    }
    if (this.allowedSourcePaths.length === 1) {
      return { ok: true, value: this.allowedSourcePaths[0] };
    }
    return toolFailure(
      "source-path-required",
      "sourcePath is required when multiple attached index sources are in scope.",
    );
  }
}

export class CheckUrlsTool implements ResearchToolHandler<CheckUrlsInput, CheckUrlsOutput> {
  readonly definition = {
    type: "function" as const,
    function: {
      name: "check_urls",
      description:
        "Check whether HTTP/HTTPS URLs are reachable. Use with URLs returned by list_index_urls.",
      parameters: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            minItems: 1,
            maxItems: MAX_URLS_PER_CHECK,
            items: { type: "string", maxLength: 2_000 },
          },
          timeoutMs: { type: "integer", minimum: MIN_TIMEOUT_MS, maximum: MAX_TIMEOUT_MS },
        },
        required: ["urls"],
        additionalProperties: false,
      },
    },
  };

  constructor(private readonly checker: UrlStatusChecker) {}

  parseInput(input: Record<string, unknown>): ResearchToolParseResult<CheckUrlsInput> {
    const unknown = Object.keys(input).find((key) => key !== "urls" && key !== "timeoutMs");
    if (unknown) {
      return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
    }
    if (!Array.isArray(input.urls) || input.urls.length === 0) {
      return toolFailure("invalid-urls", "urls must be a non-empty array.");
    }
    const urls = input.urls
      .slice(0, MAX_URLS_PER_CHECK)
      .map((url) => (typeof url === "string" ? url.trim() : ""))
      .filter((url) => url.length > 0 && url.length <= 2_000);
    if (urls.length !== input.urls.length && input.urls.length <= MAX_URLS_PER_CHECK) {
      return toolFailure("invalid-urls", "Every URL must be a bounded string.");
    }
    const timeoutMs = readTimeout(input.timeoutMs);
    if (timeoutMs === undefined) {
      return toolFailure("invalid-timeout", "timeoutMs must be an integer.");
    }

    return { ok: true, value: { urls, timeoutMs } };
  }

  async execute(
    input: CheckUrlsInput,
    context: ResearchToolExecutionContext,
  ): Promise<ResearchToolExecution<CheckUrlsOutput>> {
    try {
      const results = await this.checker.checkUrls(
        input.urls.map((url) => ({ url })),
        { timeoutMs: input.timeoutMs, signal: context.signal },
      );
      return {
        ok: true,
        value: {
          results,
          diagnostics: { checkedCount: results.length, timeoutMs: input.timeoutMs },
        },
      };
    } catch {
      return toolFailure("url-check-failed", "URL status check failed.", true);
    }
  }
}

function readOptionalString(value: unknown, maxLength: number): string | false | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return false;
  return trimmed;
}

function readLimit(value: unknown): number | undefined {
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined;
  }
  return Math.max(1, Math.min(MAX_LIMIT, value));
}

function readTimeout(value: unknown): number | undefined {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined;
  }
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, value));
}
