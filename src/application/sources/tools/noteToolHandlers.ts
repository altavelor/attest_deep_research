// Adapts the concrete note-tool service into research tool handlers. Lives in
// adapters because it depends on the concrete NoteTools definitions; the core
// ToolManager (application/core) stays free of this binding.

import { ChatToolDefinition } from "../../../core/agent/tool";
import { NoteToolService } from "../../research/toolPorts";
import { NoteToolAvailability } from "../../research/toolPorts";
import {
  failure,
  ResearchToolExecution,
  ResearchToolHandler,
  ResearchToolParseResult,
} from "../../research/ResearchTools";
import {
  NOTE_MUTATION_TOOL_DEFINITIONS,
  NOTE_TOOL_DEFINITIONS,
} from "./noteToolDefinitions";

type AnyResearchToolHandler = ResearchToolHandler<any, any>;

export function adaptNoteToolHandlers(
  service: NoteToolService,
  availability: NoteToolAvailability,
): AnyResearchToolHandler[] {
  const readDefinitions = NOTE_TOOL_DEFINITIONS.filter((definition) => {
    switch (definition.function.name) {
      case "read_note":
      case "search_notes":
      case "list_notes":
        return availability.noteAccess;
      case "get_active_note":
        return availability.activeFileAccess;
      default:
        return false;
    }
  }).map((definition) => new NoteToolHandlerAdapter(service, definition));

  const mutationDefinitions = availability.noteMutationAccess
    ? NOTE_MUTATION_TOOL_DEFINITIONS.map((definition) => new NoteToolHandlerAdapter(service, definition))
    : [];

  return [...readDefinitions, ...mutationDefinitions];
}

class NoteToolHandlerAdapter implements ResearchToolHandler<Record<string, unknown>, unknown> {
  constructor(
    private readonly service: NoteToolService,
    readonly definition: ChatToolDefinition,
  ) { }

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
    if (!execution.ok) {
      const payload = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
      const reason = typeof payload.reason === "string" ? payload.reason : "note-tool-failed";
      const hint = typeof payload.hint === "string" ? payload.hint : undefined;
      return failure(
        reason,
        `Note tool ${this.definition.function.name} failed.`,
        false,
        hint ? { hint } : undefined,
      );
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
