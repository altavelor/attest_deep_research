import { ToolParseResult, toolFailure } from "@core/agent";
import { SUB_AGENT_TOOL } from "@core/agent";
import { ResearchToolsetOptions, SubAgentPort } from "@application/research";
import { EvidenceRegistry } from "@application/sources";
import { defineTool, str } from "@application/sources/tools";

export interface SubAgentInput {
  task: string;
}

export interface SubAgentOutput {
  task: string;
  /** The sub-agent's free-text answer, already citing sources in the shared format. */
  answer: string;
  sourceCount: number;
}

const MAX_TASK_CHARS = 2_000;
const MAX_REGISTERED_SNIPPET_CHARS = 2_000;

function parseSubAgentInput(input: Record<string, unknown>): ToolParseResult<SubAgentInput> {
  const unknownProperty = Object.keys(input).find((key) => key !== "task");
  if (unknownProperty) {
    return toolFailure("unknown-property", `Unknown property: ${unknownProperty}.`, false, {
      property: unknownProperty,
    });
  }

  const task = typeof input.task === "string" ? input.task.trim() : "";
  if (!task) {
    return toolFailure("missing-task", "A task instruction is required.");
  }
  if (task.length > MAX_TASK_CHARS) {
    return toolFailure("task-too-long", `Task must not exceed ${MAX_TASK_CHARS} characters.`);
  }

  return { ok: true, value: { task } };
}

/**
 * Launches an in-process sub-agent for one self-contained task, with the same
 * read-only tools as the orchestrating (main) model (index/web/notes — no
 * mutation, no recursive run_subagent). The main model can issue several calls
 * — sequentially or in parallel — to run multiple independent sessions. Each
 * session's gathered evidence is merged into the parent run so the main model
 * can cite the same sources (URLs and evidenceIds are stable across registries,
 * so the sub-agent's own citations remain valid verbatim).
 */
export const SubAgentTool = defineTool<
  { runner: SubAgentPort; evidence: EvidenceRegistry; toolContext?: ResearchToolsetOptions },
  SubAgentInput,
  SubAgentOutput
>({
  name: SUB_AGENT_TOOL,
  description:
    "Launch a sub-agent to autonomously complete one self-contained task, with the same " +
    "read-only tools you have (index/web/notes). Use for delegating a facet of the work — " +
    "deep web research, cross-checking facts, reading and comparing several notes — " +
    "especially when several independent facets can run in parallel (up to 3 at once).",
  schema: {
    task: str(MAX_TASK_CHARS, { required: true }),
  },
  parse: parseSubAgentInput,
  execute: async (deps, input, context) => {
    let run;
    try {
      run = await deps.runner.run({
        task: input.task,
        toolContext: deps.toolContext,
        signal: context.signal,
        onEvent: (event) => context.emit(event),
      });
    } catch {
      return toolFailure("sub-agent-failed", "Sub-agent session failed.", true);
    }

    let sourceCount = 0;
    for (const chunk of run.snapshot.evidence) {
      const provenance = run.snapshot.provenance.find((entry) => entry.evidenceId === chunk.id);
      const call = provenance?.calls[0];
      try {
        if (chunk.source.kind === "web") {
          deps.evidence.registerWebResult(
            {
              url: chunk.source.url,
              title: chunk.source.title,
              snippet: chunk.text.slice(0, MAX_REGISTERED_SNIPPET_CHARS),
              rank: sourceCount + 1,
            },
            { callId: context.callId, query: call?.query ?? input.task },
          );
        } else if (call?.tool === "read_note" || call?.tool === "get_active_note") {
          deps.evidence.registerNoteEvidence(
            { evidenceId: chunk.id, source: chunk.source, content: chunk.text },
            { callId: context.callId, tool: call.tool },
          );
        } else {
          deps.evidence.registerIndexChunk(chunk, {
            callId: context.callId,
            query: call?.query ?? input.task,
          });
        }
        sourceCount += 1;
      } catch {}
    }

    return {
      ok: true,
      value: {
        task: input.task,
        answer: run.answerText,
        sourceCount,
      },
    };
  },
});
