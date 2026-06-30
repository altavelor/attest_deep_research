// Core agent: tool-call protocol primitives. Platform-neutral.

export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "specific"; name: string };

export interface ToolCallingCapabilities {
  calls: boolean;
  choiceRequired: boolean;
  choiceSpecific: boolean;
  parallelCalls: boolean;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

// --- Universal tool abstraction + manager (stage 1, task 4.1 / R3) ---
// A Tool is anything the model can invoke; the ToolManager is how the agent loop
// discovers and dispatches them. Adding a capability = implement Tool + register;
// the loop/core never changes.

/** Progress/streaming event a tool can surface mid-execution (forwarded by the caller). */
export interface ToolEvent {
  type: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ToolContext {
  callId: string;
  /** Cancellation for long-running tools (e.g. web fetch); honoured by the tool. */
  signal: AbortSignal;
  /** Surface progress out of the tool; the dispatcher decides where it goes. */
  emit(event: ToolEvent): void;
}

/** What a dispatcher (loop / runner) optionally supplies when executing a tool. */
export interface ToolDispatchContext {
  signal?: AbortSignal;
  emit?: (event: ToolEvent) => void;
}

// A signal that never aborts, for callers that don't supply one. Cast keeps this
// platform-neutral: core only relies on the minimal AbortSignal surface.
const NEVER_ABORT_SIGNAL = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
} as unknown as AbortSignal;
const NOOP_EMIT = (): void => {};

function resolveToolContext(callId: string, context: ToolDispatchContext): ToolContext {
  return {
    callId,
    signal: context.signal ?? NEVER_ABORT_SIGNAL,
    emit: context.emit ?? NOOP_EMIT,
  };
}

export type ToolParseResult<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export type ToolExecution<T> =
  | { ok: true; value: T; diagnostic?: Record<string, unknown> }
  | { ok: false; error: ToolError; diagnostic?: Record<string, unknown> };

/**
 * Permissions granted for a run, as an opaque set of capability names. Neutral by
 * design: core defines the shape, the application maps its own gating policy onto
 * the names and a tool's {@link Tool.requires} predicate decides against them.
 */
export type ToolPermissions = ReadonlySet<string>;

export interface Tool<TInput = unknown, TOutput = unknown> {
  definition: ChatToolDefinition;
  parseInput(input: Record<string, unknown>): ToolParseResult<TInput>;
  execute(input: TInput, context: ToolContext): Promise<ToolExecution<TOutput>>;
  /**
   * Optional permission gate. When present and the granted permissions do not
   * satisfy it, the dispatcher (e.g. ToolManager) hides the tool from the model
   * and refuses to execute it. Absent ⇒ always available.
   */
  requires?(permissions: ToolPermissions): boolean;
}

export async function executeTool<TInput, TOutput>(
  handler: Tool<TInput, TOutput>,
  call: ChatToolCall,
  context: ToolDispatchContext = {},
): Promise<ToolExecution<TOutput>> {
  if (call.name !== handler.definition.function.name) {
    return toolFailure(
      "invalid-tool-name",
      `Expected ${handler.definition.function.name}, received ${call.name}.`,
    );
  }

  const parsed = handler.parseInput(call.arguments);
  if (!parsed.ok) {
    return parsed;
  }

  return handler.execute(parsed.value, resolveToolContext(call.id, context));
}

export function toolFailure(
  code: string,
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): ToolExecution<never> {
  return {
    ok: false,
    error: { code, message, retryable, ...(details ? { details } : {}) },
  };
}

export function toolExecutionPayload(execution: ToolExecution<unknown>): Record<string, unknown> {
  if (!execution.ok) {
    return { ok: false, error: execution.error };
  }
  if (isRecord(execution.value)) {
    return "ok" in execution.value ? execution.value : { ok: true, ...execution.value };
  }
  return { ok: true, result: execution.value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
