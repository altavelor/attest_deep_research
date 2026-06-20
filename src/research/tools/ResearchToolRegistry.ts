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
import { ResearchEvidenceRegistry } from "./ResearchEvidenceRegistry";
import { isInternalSkillPath } from "../../shared/pathFilters";

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
  evidence?: ResearchEvidenceRegistry,
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
  }).map(
    (definition) =>
      new NoteToolHandlerAdapter(
        service,
        definition,
        evidence,
        definition.function.name === "read_note" && !availability.noteAccess,
      ),
  );
}

class NoteToolHandlerAdapter implements ResearchToolHandler<Record<string, unknown>, unknown> {
  constructor(
    private readonly service: NoteToolService,
    readonly definition: ChatToolDefinition,
    private readonly evidence?: ResearchEvidenceRegistry,
    private readonly skillOnly = false,
  ) {}

  parseInput(input: Record<string, unknown>): ResearchToolParseResult<Record<string, unknown>> {
    if (
      this.skillOnly &&
      (typeof input.path !== "string" || !isInternalSkillPath(input.path))
    ) {
      return failure("tool-unavailable", "Only an exact internal skill path is available.");
    }
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
    if (!execution.ok) {
      const reason =
        typeof value === "object" && value !== null && "reason" in value
          ? String(value.reason)
          : "note-tool-failed";
      return failure(reason, `Note tool ${this.definition.function.name} failed.`, false);
    }
    if (
      this.evidence &&
      (this.definition.function.name === "read_note" || this.definition.function.name === "get_active_note") &&
      isEvidenceResult(value)
    ) {
      for (const chunk of value.chunks) {
        this.evidence.registerNoteEvidence(
          { evidenceId: chunk.id, source: chunk.evidenceSource, content: chunk.text },
          { callId: context.callId, tool: this.definition.function.name },
        );
      }
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

function isEvidenceResult(value: unknown): value is {
  chunks: Array<{
    id: string;
    evidenceSource: import("../../shared/types").SourceReference;
    text: string;
  }>;
} {
  if (typeof value !== "object" || value === null) return false;
  const chunks = (value as Record<string, unknown>).chunks;
  return Array.isArray(chunks) && chunks.every((chunk) =>
    typeof chunk === "object" && chunk !== null &&
    typeof (chunk as Record<string, unknown>).id === "string" &&
    typeof (chunk as Record<string, unknown>).text === "string" &&
    typeof (chunk as Record<string, unknown>).evidenceSource === "object" &&
    (chunk as Record<string, unknown>).evidenceSource !== null
  );
}
