import { ChatToolCall, ChatToolDefinition, ToolError } from "../../shared/types";

export interface ResearchToolExecutionContext {
  callId: string;
}

export type ResearchToolParseResult<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export type ResearchToolExecution<T> =
  | { ok: true; value: T; diagnostic?: Record<string, unknown> }
  | { ok: false; error: ToolError; diagnostic?: Record<string, unknown> };

export interface ResearchToolHandler<TInput = unknown, TOutput = unknown> {
  definition: ChatToolDefinition;
  parseInput(input: Record<string, unknown>): ResearchToolParseResult<TInput>;
  execute(
    input: TInput,
    context: ResearchToolExecutionContext,
  ): Promise<ResearchToolExecution<TOutput>>;
}

export interface BoundedSearchInput {
  query: string;
  limit: number;
}

export const DEFAULT_RESEARCH_RESULT_LIMIT = 5;
export const MAX_RESEARCH_RESULT_LIMIT = 5;
export const MAX_RESEARCH_QUERY_CHARS = 240;

export async function executeResearchTool<TInput, TOutput>(
  handler: ResearchToolHandler<TInput, TOutput>,
  call: ChatToolCall,
): Promise<ResearchToolExecution<TOutput>> {
  if (call.name !== handler.definition.function.name) {
    return failure(
      "invalid-tool-name",
      `Expected ${handler.definition.function.name}, received ${call.name}.`,
    );
  }

  const parsed = handler.parseInput(call.arguments);
  if (!parsed.ok) {
    return parsed;
  }

  return handler.execute(parsed.value, { callId: call.id });
}

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

export function failure(
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): ResearchToolExecution<never> {
  return {
    ok: false,
    error: { code, message, retryable, ...(details ? { details } : {}) },
  };
}

export function researchToolExecutionPayload(
  execution: ResearchToolExecution<unknown>,
): Record<string, unknown> {
  if (!execution.ok) {
    return { ok: false, error: execution.error };
  }
  if (isRecord(execution.value)) {
    return "ok" in execution.value ? execution.value : { ok: true, ...execution.value };
  }
  return { ok: true, result: execution.value };
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
