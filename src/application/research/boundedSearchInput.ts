import { ToolParseResult, toolFailure } from "@core/agent";
import {
  isWebQueryIntent,
  isWebQueryRecency,
  WebQueryIntent,
  WebQueryRecency,
} from "@core/web";

export interface BoundedSearchInput {
  query: string;
  limit: number;
}

export interface WebSearchInput extends BoundedSearchInput {
  /** Model-declared query category; routes the search to matching hub sources. */
  category?: WebQueryIntent;
  /** Model-declared freshness window; mapped to native date filters per source. */
  recency?: WebQueryRecency;
}

export const DEFAULT_RESEARCH_RESULT_LIMIT = 5;
export const MAX_RESEARCH_RESULT_LIMIT = 5;
/** Web searches merge several sources, so broad queries may ask for more links. */
export const MAX_WEB_RESULT_LIMIT = 15;
export const MAX_RESEARCH_QUERY_CHARS = 240;

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

/** Web variant of the bounded parser: query/limit plus optional category and recency. */
export function parseWebSearchInput(
  input: Record<string, unknown>,
): ToolParseResult<WebSearchInput> {
  const { category, recency, ...rest } = input;
  const base = parseBoundedSearchInput(rest, MAX_WEB_RESULT_LIMIT);
  if (!base.ok) {
    return base;
  }
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
      ...base.value,
      ...(category !== undefined ? { category } : {}),
      ...(recency !== undefined ? { recency } : {}),
    },
  };
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
