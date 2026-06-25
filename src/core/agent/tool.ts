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

export interface ToolContext {
  callId: string;
}

export type ToolParseResult<T> = { ok: true; value: T } | { ok: false; error: ToolError };

export type ToolExecution<T> =
  | { ok: true; value: T; diagnostic?: Record<string, unknown> }
  | { ok: false; error: ToolError; diagnostic?: Record<string, unknown> };

export interface Tool<TInput = unknown, TOutput = unknown> {
  definition: ChatToolDefinition;
  parseInput(input: Record<string, unknown>): ToolParseResult<TInput>;
  execute(input: TInput, context: ToolContext): Promise<ToolExecution<TOutput>>;
}

export async function executeTool<TInput, TOutput>(
  handler: Tool<TInput, TOutput>,
  call: ChatToolCall,
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

  return handler.execute(parsed.value, { callId: call.id });
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

/**
 * Generic registry the agent loop queries for tools. Holds the handler map,
 * exposes definitions to send to the model, and dispatches calls by name.
 * Layers above (e.g. SourceManager) contribute tools into a ToolManager.
 */
export class ToolManager {
  private readonly handlers = new Map<string, Tool<any, any>>();

  constructor(tools: Tool<any, any>[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: Tool<any, any>): void {
    const name = tool.definition.function.name;
    if (this.handlers.has(name)) {
      throw new Error(`Duplicate tool: ${name}.`);
    }
    this.handlers.set(name, tool);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  definitions(): ChatToolDefinition[] {
    return Array.from(this.handlers.values(), (handler) => handler.definition);
  }

  async execute(call: ChatToolCall): Promise<ToolExecution<unknown>> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return toolFailure("unknown-tool", `Unknown or unavailable tool: ${call.name}.`);
    }
    return executeTool(handler, call);
  }
}
