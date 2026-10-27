import { ToolParseResult, toolFailure } from "@core/agent";
import { SUB_AGENT_TOOL } from "@core/agent";
import {
  DEFAULT_SUB_AGENT_SEARCHES,
  deriveSubAgentTitle,
  MAX_SUB_AGENT_RESOURCE_CHARS,
  MAX_SUB_AGENT_RESOURCES,
  MAX_SUB_AGENT_SEARCHES,
  MAX_SUB_AGENT_TASK_CHARS,
  MIN_SUB_AGENT_SEARCHES,
  readSubAgentSearchBudget,
  validateSubAgentResources,
  validateSubAgentTaskInput,
  type SubAgentRunReceipt,
} from "@core/research";
import type { SubAgentDelegator, SubAgentParentRun } from "@application/ports/subAgent";
import { defineTool, enumOf, int, str, strArray } from "@application/sources/tools";
import { subAgentCallIdentity, subAgentToolFailure } from "./subAgentCalls";

export type SubAgentCommandKind = "follow-up" | "continue-partial" | "retry";

export interface SubAgentInput {
  task: string;
  maxSearches: number;
  resources?: string[];
  sessionId?: string;
  command?: SubAgentCommandKind;
  runId?: string;
}

export interface SubAgentOutput {
  state: "accepted";
  receipt: SubAgentRunReceipt;
}

export interface SubAgentToolDeps {
  delegator: SubAgentDelegator;
  parent: SubAgentParentRun;
}

const PROPERTIES = ["task", "maxSearches", "resources", "sessionId", "command", "runId"];
const COMMANDS: readonly SubAgentCommandKind[] = ["follow-up", "continue-partial", "retry"];
const MAX_ID_CHARS = 200;

function parseSubAgentInput(input: Record<string, unknown>): ToolParseResult<SubAgentInput> {
  const unknownProperty = Object.keys(input).find((key) => !PROPERTIES.includes(key));
  if (unknownProperty) {
    return toolFailure("unknown-property", `Unknown property: ${unknownProperty}.`, false, {
      property: unknownProperty,
    });
  }

  const task = validateSubAgentTaskInput(input.task);
  if (!task.ok) return toolFailure(task.code, task.message);
  const maxSearches = readSubAgentSearchBudget(input.maxSearches);
  if (!maxSearches.ok) return toolFailure(maxSearches.code, maxSearches.message);
  const resources = validateSubAgentResources(input.resources);
  if (!resources.ok) return toolFailure(resources.code, resources.message);
  const sessionId = optionalId(input.sessionId);
  const runId = optionalId(input.runId);
  const command = input.command as SubAgentCommandKind | undefined;
  if (
    sessionId === null ||
    runId === null ||
    (command !== undefined && (!COMMANDS.includes(command) || sessionId === undefined)) ||
    ((command === "retry" || command === "continue-partial") && runId === undefined)
  ) {
    return toolFailure(
      "invalid-command",
      "A follow-up needs sessionId; continue-partial and retry also need the runId they refer to.",
    );
  }

  return {
    ok: true,
    value: {
      task: task.value,
      maxSearches: maxSearches.value,
      ...(resources.value.length > 0 ? { resources: resources.value } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(sessionId !== undefined ? { command: command ?? "follow-up" } : {}),
      ...(runId !== undefined ? { runId } : {}),
    },
  };
}

/**
 * Sends one command to a child session through the parent run's delegator and returns
 * its accepted receipt at once; the result is delivered separately. The create and
 * submission identities derive from the parent run, model round and call, so a replayed
 * call reuses the session and run it already started instead of starting another.
 */
export const SubAgentTool = defineTool<SubAgentToolDeps, SubAgentInput, SubAgentOutput>({
  name: SUB_AGENT_TOOL,
  description:
    "Start a sub-agent on one self-contained task, with the same read-only tools you have " +
    "(index/web/notes). It returns immediately with an accepted receipt, not an answer: the " +
    "sub-agent works in the background while you continue, and its result arrives before a " +
    "later round (or read it with get_subagent_result). Use it for a facet that needs its own " +
    "research loop, especially several independent facets in parallel. Pass sessionId to send " +
    "a follow-up, continue-partial or retry command to an existing sub-agent of this chat, " +
    "including one started in an earlier turn.",
  schema: {
    task: str(MAX_SUB_AGENT_TASK_CHARS, {
      required: true,
      description: "Self-contained task or follow-up for the sub-agent, with success criteria.",
    }),
    maxSearches: int(MIN_SUB_AGENT_SEARCHES, MAX_SUB_AGENT_SEARCHES, DEFAULT_SUB_AGENT_SEARCHES, {
      description:
        "Maximum search calls the sub-agent may spend on the whole task. Keep it small; " +
        "further searches are rejected.",
    }),
    resources: strArray(MAX_SUB_AGENT_RESOURCES, MAX_SUB_AGENT_RESOURCE_CHARS, {
      description:
        "Sites, domains, or named sources the sub-agent must restrict itself to, " +
        'e.g. "wikipedia.org", "official investor relations pages".',
    }),
    sessionId: str(MAX_ID_CHARS, {
      description:
        "An existing sub-agent session of this chat, from any earlier receipt or turn; " +
        "omit to start a new one.",
    }),
    command: enumOf(COMMANDS, {
      description: "With sessionId: follow-up (default), continue-partial or retry.",
    }),
    runId: str(MAX_ID_CHARS, {
      description: "The run that continue-partial continues or retry repeats.",
    }),
  },
  parse: parseSubAgentInput,
  execute: async (deps, input, context) => {
    const identity = subAgentCallIdentity(deps.parent.parentRunId, context.round, context.callId);
    try {
      const receipt = await submit(deps.delegator, input, identity);
      return {
        ok: true,
        value: { state: "accepted", receipt },
        diagnostic: { runId: receipt.runId, sessionId: receipt.sessionId, accepted: true },
      };
    } catch (error) {
      return subAgentToolFailure(error);
    }
  },
});

async function submit(
  delegator: SubAgentDelegator,
  input: SubAgentInput,
  identity: string,
): Promise<SubAgentRunReceipt> {
  const submissionId = `submit-${identity}`;
  if (input.sessionId === undefined) {
    const session = await delegator.create({
      createRequestId: `create-${identity}`,
      title: deriveSubAgentTitle(input.task),
      maxSearches: input.maxSearches,
      ...(input.resources ? { resources: input.resources } : {}),
    });
    return delegator.run(
      session.subAgentSessionId,
      { type: "initial", task: input.task },
      submissionId,
    );
  }
  if (input.command === "retry") {
    return delegator.retry(input.sessionId, { runId: input.runId! }, submissionId);
  }
  if (input.command === "continue-partial") {
    return delegator.continue(
      input.sessionId,
      { type: "continue-partial", task: input.task, fromRunId: input.runId! },
      submissionId,
    );
  }
  return delegator.continue(input.sessionId, { type: "follow-up", task: input.task }, submissionId);
}

function optionalId(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_CHARS
    ? value
    : null;
}
