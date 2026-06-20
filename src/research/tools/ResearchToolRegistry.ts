import { ChatToolCall, ChatToolDefinition } from "../../shared/types";
import { NOTE_TOOL_DEFINITIONS, NoteToolService } from "./NoteTools";
import {
  executeResearchTool,
  failure,
  ResearchToolExecution,
  ResearchToolHandler,
  ResearchToolParseResult,
} from "./ResearchTools";
import { ResearchSearchMode } from "../types";

export interface ResearchToolAvailability {
  searchMode: ResearchSearchMode;
  noteAccess: boolean;
  activeFileAccess: boolean;
  skillAccess: boolean;
  retrieverAvailable: boolean;
  webProviderAvailable: boolean;
}

export interface NoteToolAvailability {
  noteAccess: boolean;
  activeFileAccess: boolean;
  skillAccess: boolean;
}

type AnyResearchToolHandler = ResearchToolHandler<any, any>;

const DEFAULT_AVAILABILITY: ResearchToolAvailability = {
  searchMode: "none",
  noteAccess: false,
  activeFileAccess: false,
  skillAccess: false,
  retrieverAvailable: false,
  webProviderAvailable: false,
};

export class ResearchToolRegistry {
  private readonly handlers = new Map<string, AnyResearchToolHandler>();
  private readonly policy: ResearchToolAvailability;

  constructor(
    handlers: AnyResearchToolHandler[],
    availability: ResearchToolAvailability = DEFAULT_AVAILABILITY,
  ) {
    this.policy = { ...availability };
    for (const handler of handlers) {
      const name = handler.definition.function.name;
      if (this.handlers.has(name)) {
        throw new Error(`Duplicate research tool: ${name}.`);
      }
      this.handlers.set(name, handler);
    }
  }

  definitions(): ChatToolDefinition[] {
    return Array.from(this.handlers.values(), (handler) => handler.definition);
  }

  availability(): ResearchToolAvailability {
    return { ...this.policy };
  }

  async execute(call: ChatToolCall): Promise<ResearchToolExecution<unknown>> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return failure("unknown-tool", `Unknown or unavailable research tool: ${call.name}.`);
    }
    return executeResearchTool(handler, call);
  }
}

export function adaptNoteToolHandlers(
  service: NoteToolService,
  availability: NoteToolAvailability,
): AnyResearchToolHandler[] {
  return NOTE_TOOL_DEFINITIONS.filter((definition) => {
    switch (definition.function.name) {
      case "read_note":
        return availability.noteAccess || availability.skillAccess;
      case "search_notes":
      case "list_notes":
        return availability.noteAccess;
      case "get_active_note":
        return availability.activeFileAccess;
      default:
        return false;
    }
  }).map((definition) => new NoteToolHandlerAdapter(service, definition));
}

class NoteToolHandlerAdapter implements ResearchToolHandler<Record<string, unknown>, unknown> {
  constructor(
    private readonly service: NoteToolService,
    readonly definition: ChatToolDefinition,
  ) {}

  parseInput(input: Record<string, unknown>): ResearchToolParseResult<Record<string, unknown>> {
    return { ok: true, value: input };
  }

  async execute(
    input: Record<string, unknown>,
    context: { callId: string },
  ): Promise<ResearchToolExecution<unknown>> {
    const execution = await this.service.execute({
      id: context.callId,
      name: this.definition.function.name,
      arguments: input,
    });
    let value: unknown;
    try {
      value = JSON.parse(execution.result) as unknown;
    } catch {
      throw new Error(`Note tool ${this.definition.function.name} returned invalid JSON.`);
    }
    return {
      ok: true,
      value,
      diagnostic: {
        legacyExecutionOk: execution.ok,
        ...(execution.diagnostic ?? {}),
      },
    };
  }
}
