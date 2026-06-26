// Research tool helpers. The universal tool abstraction now lives in core/agent
// (stage 1, task 4.1) and is re-exported here under the established names so the
// research tool implementations keep working unchanged. Only research-specific
// input parsing (bounded search queries) remains defined here.

import {
  Tool,
  ToolContext,
  ToolExecution,
  ToolParseResult,
  executeTool,
  toolExecutionPayload,
  toolFailure,
} from "../../core/agent/tool";

// Established research-facing aliases of the core tool abstraction.
export type ResearchToolHandler<TInput = unknown, TOutput = unknown> = Tool<TInput, TOutput>;
export type ResearchToolExecutionContext = ToolContext;
export type ResearchToolParseResult<T> = ToolParseResult<T>;
export type ResearchToolExecution<T> = ToolExecution<T>;

export const executeResearchTool = executeTool;
export const failure = toolFailure;
export const researchToolExecutionPayload = toolExecutionPayload;

export interface BoundedSearchInput {
  query: string;
  limit: number;
}

export const DEFAULT_RESEARCH_RESULT_LIMIT = 5;
export const MAX_RESEARCH_RESULT_LIMIT = 5;
export const MAX_RESEARCH_QUERY_CHARS = 240;

export function parseBoundedSearchInput(
  input: Record<string, unknown>,
): ResearchToolParseResult<BoundedSearchInput> {
  const unknownProperty = Object.keys(input).find((key) => key !== "query" && key !== "limit");
  if (unknownProperty) {
    return failure("unknown-property", `Unknown property: ${unknownProperty}.`, false, {
      property: unknownProperty,
    });
  }

  const query = typeof input.query === "string" ? normalizeQuery(input.query) : "";
  if (!query) {
    return failure("missing-query", "Query is required.");
  }
  if (query.length > MAX_RESEARCH_QUERY_CHARS) {
    return failure(
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
    return failure("invalid-limit", "Limit must be an integer.");
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
