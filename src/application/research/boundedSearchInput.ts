import { ToolParseResult, toolFailure } from "@core/agent";
import {
  isWebQueryIntent,
  isWebQueryRecency,
  MAX_WEB_QUERIES_PER_CALL,
  MAX_WEB_QUERY_CHARS,
  MAX_WEB_RESULT_LIMIT,
  WebQueryIntent,
  WebQueryRecency,
} from "@core/web";

export interface BoundedSearchInput {
  query: string;
  limit: number;
}

export interface WebSearchInput {
  query?: string;

  queries: string[];
  limit: number;
  category?: WebQueryIntent;

  recency?: WebQueryRecency;
}

export const DEFAULT_RESEARCH_RESULT_LIMIT = 5;
export const MAX_RESEARCH_RESULT_LIMIT = 5;

export const MAX_RESEARCH_QUERY_CHARS = MAX_WEB_QUERY_CHARS;

export { MAX_WEB_QUERIES_PER_CALL, MAX_WEB_RESULT_LIMIT };

export function parseBoundedSearchInput(
  input: Record<string, unknown>,
  maxLimit: number = MAX_RESEARCH_RESULT_LIMIT,
): ToolParseResult<BoundedSearchInput> {
  const unknownProperty = Object.keys(input).find((key) => key !== "query" && key !== "limit");
  if (unknownProperty) {
    return toolFailure("unknown-property", `Unknown property: ${unknownProperty}.`, false, {
      property: unknownProperty,
    });
  }

  const query = typeof input.query === "string" ? normalizeQuery(input.query) : "";
  if (!query) {
    return toolFailure("missing-query", "Query is required.");
  }
  if (query.length > MAX_RESEARCH_QUERY_CHARS) {
    return toolFailure(
      "query-too-long",
      `Query must not exceed ${MAX_RESEARCH_QUERY_CHARS} characters.`,
      false,
      {
        maxChars: MAX_RESEARCH_QUERY_CHARS,
      },
    );
  }

  if (
    input.limit !== undefined &&
    (typeof input.limit !== "number" ||
      !Number.isFinite(input.limit) ||
      !Number.isInteger(input.limit))
  ) {
    return toolFailure("invalid-limit", "Limit must be an integer.");
  }

  return {
    ok: true,
    value: {
      query,
      limit: Math.max(1, Math.min(maxLimit, input.limit ?? DEFAULT_RESEARCH_RESULT_LIMIT)),
    },
  };
}

/**
 * Web variant of the bounded parser. Accepts either a single `query` or a
 * batch of up to {@link MAX_WEB_QUERIES_PER_CALL} distinct `queries`, plus the
 * optional category and recency filters.
 */
export function parseWebSearchInput(
  input: Record<string, unknown>,
): ToolParseResult<WebSearchInput> {
  const unknownProperty = Object.keys(input).find(
    (key) => !["query", "queries", "limit", "category", "recency"].includes(key),
  );
  if (unknownProperty) {
    return toolFailure("unknown-property", `Unknown property: ${unknownProperty}.`, false, {
      property: unknownProperty,
    });
  }

  const hasSingle = Object.prototype.hasOwnProperty.call(input, "query");
  const hasBatch = Object.prototype.hasOwnProperty.call(input, "queries");
  if (hasSingle && hasBatch) {
    return toolFailure("conflicting-query", "Pass either `query` or `queries`, not both.");
  }
  if (hasSingle && typeof input.query !== "string") {
    return toolFailure("invalid-query", "`query` must be a non-empty string.");
  }

  const single = typeof input.query === "string" ? normalizeQuery(input.query) : "";
  if (hasSingle && !single) {
    return toolFailure("invalid-query", "`query` must be a non-empty string.");
  }
  const batch = parseQueryBatch(input.queries);
  if (batch === false) {
    return toolFailure(
      "invalid-queries",
      `\`queries\` must be an array of 1-${MAX_WEB_QUERIES_PER_CALL} non-empty strings.`,
    );
  }

  const queries = batch ?? (single ? [single] : []);
  if (queries.length === 0) {
    return toolFailure("missing-query", "Query is required.");
  }
  const tooLong = queries.find((query) => query.length > MAX_WEB_QUERY_CHARS);
  if (tooLong !== undefined) {
    return toolFailure(
      "query-too-long",
      `Query must not exceed ${MAX_WEB_QUERY_CHARS} characters.`,
      false,
      { maxChars: MAX_WEB_QUERY_CHARS },
    );
  }

  if (
    input.limit !== undefined &&
    (typeof input.limit !== "number" ||
      !Number.isFinite(input.limit) ||
      !Number.isInteger(input.limit))
  ) {
    return toolFailure("invalid-limit", "Limit must be an integer.");
  }

  const { category, recency } = input;
  if (category !== undefined && !isWebQueryIntent(category)) {
    return toolFailure(
      "invalid-category",
      "Category must be one of: academic, code, news, encyclopedic, general.",
    );
  }
  if (recency !== undefined && !isWebQueryRecency(recency)) {
    return toolFailure("invalid-recency", "Recency must be one of: day, week, month.");
  }

  return {
    ok: true,
    value: {
      ...(batch === undefined ? { query: queries[0] } : {}),
      queries,
      limit: Math.max(
        1,
        Math.min(MAX_WEB_RESULT_LIMIT, input.limit ?? DEFAULT_RESEARCH_RESULT_LIMIT),
      ),
      ...(category !== undefined ? { category } : {}),
      ...(recency !== undefined ? { recency } : {}),
    },
  };
}

function parseQueryBatch(value: unknown): string[] | false | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WEB_QUERIES_PER_CALL) {
    return false;
  }
  const normalized = value.map((entry) => (typeof entry === "string" ? normalizeQuery(entry) : ""));
  if (normalized.some((entry) => entry.length === 0)) return false;
  return [...new Set(normalized)];
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
