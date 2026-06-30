import {
  ChatToolCall,
  ChatToolDefinition,
  Tool,
  ToolDispatchContext,
  ToolExecution,
  ToolPermissions,
  executeTool,
  toolFailure,
} from "../../core/agent/tool";

/**
 * Registry the agent loop queries for tools. Holds the handler map, exposes
 * definitions to send to the model, and dispatches calls by name — and gates
 * both by the run's granted permissions (each tool's {@link Tool.requires}).
 *
 * Lives in `application`: it is orchestration, not a core primitive. The core
 * AgentLoop stays decoupled (it consumes `definitions()` + an `executeTool`
 * callback), so moving the manager here does not pull core outward.
 *
 * When constructed without `permissions`, no gating is applied (every tool is
 * available) — keeps composition that doesn't model permissions unchanged.
 */
export class ToolManager {
  private readonly handlers = new Map<string, Tool<any, any>>();
  private readonly permissions?: ToolPermissions;

  constructor(tools: Tool<any, any>[] = [], permissions?: ToolPermissions) {
    this.permissions = permissions;
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

  /** True only when the tool is registered *and* permitted for this run. */
  has(name: string): boolean {
    const handler = this.handlers.get(name);
    return handler !== undefined && this.permits(handler);
  }

  definitions(): ChatToolDefinition[] {
    return Array.from(this.handlers.values())
      .filter((handler) => this.permits(handler))
      .map((handler) => handler.definition);
  }

  async execute(
    call: ChatToolCall,
    context: ToolDispatchContext = {},
  ): Promise<ToolExecution<unknown>> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return toolFailure("unknown-tool", `Unknown or unavailable tool: ${call.name}.`);
    }
    if (!this.permits(handler)) {
      return toolFailure("tool-not-permitted", `Tool not permitted for this run: ${call.name}.`);
    }
    return executeTool(handler, call, context);
  }

  private permits(tool: Tool<any, any>): boolean {
    if (this.permissions === undefined || tool.requires === undefined) {
      return true;
    }
    return tool.requires(this.permissions);
  }
}
