import {
  SUB_AGENT_RESULT_TOOL,
  SUB_AGENT_WAIT_TOOL,
  toolFailure,
  type ToolParseResult,
} from "@core/agent";
import type { SubAgentRunRef } from "@core/research";
import type {
  SubAgentDelegator,
  SubAgentParentRun,
  SubAgentWaitResult,
} from "@application/ports/subAgent";
import { viewSubAgentResult, type SubAgentResultView } from "@application/research";
import type { EvidenceRegistry } from "@application/sources";
import { defineTool, enumOf, int, raw, str } from "@application/sources/tools";
import { subAgentToolFailure } from "./subAgentCalls";

export interface SubAgentResultToolDeps {
  delegator: SubAgentDelegator;
  parent: SubAgentParentRun;
  evidence: EvidenceRegistry;
}

const MAX_ID_CHARS = 200;
const MAX_WAIT_REFS = 12;
const MAX_WAIT_TIMEOUT_MS = 30_000;

/**
 * Reads the current result of one child run. It is idempotent: a completed result
 * aliases its imported evidence into this run again without repeating import or work.
 */
export const SubAgentResultTool = defineTool<
  SubAgentResultToolDeps,
  SubAgentRunRef,
  SubAgentResultView
>({
  name: SUB_AGENT_RESULT_TOOL,
  description:
    "Read the current state of a sub-agent run from its receipt: pending, completed with its " +
    "answer and sources, failed or interrupted. Safe to call again; it never restarts work.",
  schema: {
    sessionId: str(MAX_ID_CHARS, { required: true, description: "sessionId from the receipt." }),
    runId: str(MAX_ID_CHARS, { required: true, description: "runId from the receipt." }),
  },
  execute: async (deps, input) => {
    try {
      const state = await deps.delegator.getResult(input.sessionId, input.runId);
      return {
        ok: true,
        value: await viewSubAgentResult(input, state, deps.parent.resolver, deps.evidence),
      };
    } catch (error) {
      return subAgentToolFailure(error);
    }
  },
});

interface WaitInput {
  refs: SubAgentRunRef[];
  mode: "any" | "all";
  timeoutMs: number;
}

function parseWaitInput(input: Record<string, unknown>): ToolParseResult<WaitInput> {
  const refs = Array.isArray(input.refs) ? input.refs.slice(0, MAX_WAIT_REFS + 1) : null;
  const parsed = refs?.map(readRef) ?? [];
  const timeoutMs = input.timeoutMs ?? MAX_WAIT_TIMEOUT_MS;
  if (
    !refs ||
    refs.length === 0 ||
    refs.length > MAX_WAIT_REFS ||
    parsed.some((ref) => ref === null) ||
    (input.mode !== undefined && input.mode !== "any" && input.mode !== "all") ||
    !Number.isInteger(timeoutMs) ||
    (timeoutMs as number) < 0 ||
    (timeoutMs as number) > MAX_WAIT_TIMEOUT_MS
  ) {
    return toolFailure(
      "invalid-wait",
      `Pass 1-${MAX_WAIT_REFS} {sessionId, runId} refs, mode any or all, and timeoutMs up to ${MAX_WAIT_TIMEOUT_MS}.`,
    );
  }
  return {
    ok: true,
    value: {
      refs: parsed as SubAgentRunRef[],
      mode: input.mode === "all" ? "all" : "any",
      timeoutMs: timeoutMs as number,
    },
  };
}

function readRef(value: unknown): SubAgentRunRef | null {
  if (typeof value !== "object" || value === null) return null;
  const { sessionId, runId } = value as Record<string, unknown>;
  return typeof sessionId === "string" &&
    typeof runId === "string" &&
    sessionId.length <= MAX_ID_CHARS &&
    runId.length <= MAX_ID_CHARS
    ? { sessionId, runId }
    : null;
}

/**
 * Waits until any or all listed child runs finish or the timeout passes. A timeout or
 * a cancelled wait never stops the children; read finished runs with get_subagent_result.
 */
export const SubAgentWaitTool = defineTool<
  Pick<SubAgentResultToolDeps, "delegator">,
  WaitInput,
  SubAgentWaitResult
>({
  name: SUB_AGENT_WAIT_TOOL,
  description:
    "Wait up to 30 seconds for sub-agent runs to finish without stopping them. Returns the " +
    "refs that are ready and whether the wait timed out. Refs may name runs of this chat's " +
    "sub-agent sessions from earlier turns.",
  schema: {
    refs: raw(
      {
        type: "array",
        maxItems: MAX_WAIT_REFS,
        items: {
          type: "object",
          properties: { sessionId: { type: "string" }, runId: { type: "string" } },
          required: ["sessionId", "runId"],
        },
      },
      { required: true },
    ),
    mode: enumOf(["any", "all"], { description: "Return when any or when all are ready." }),
    timeoutMs: int(0, MAX_WAIT_TIMEOUT_MS, MAX_WAIT_TIMEOUT_MS, {
      description: "Longest wait in milliseconds.",
    }),
  },
  parse: parseWaitInput,
  execute: async (deps, input, context) => {
    try {
      return {
        ok: true,
        value: await deps.delegator.waitForResults(input.refs, {
          mode: input.mode,
          timeoutMs: input.timeoutMs,
          signal: context.signal,
        }),
      };
    } catch (error) {
      return subAgentToolFailure(error);
    }
  },
});
