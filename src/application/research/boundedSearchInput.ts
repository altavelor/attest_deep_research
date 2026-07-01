import { ToolParseResult, toolFailure } from "@core/agent";

export interface BoundedSearchInput {
  query: string;
  limit: number;
}

export const DEFAULT_RESEARCH_RESULT_LIMIT = 5;
export const MAX_RESEARCH_RESULT_LIMIT = 5;
export const MAX_RESEARCH_QUERY_CHARS = 240;

export function parseBoundedSearchInput(
  input: Record<string, unknown>,
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
      limit: Math.max(
        1,
        Math.min(MAX_RESEARCH_RESULT_LIMIT, input.limit ?? DEFAULT_RESEARCH_RESULT_LIMIT),
      ),
    },
  };
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
