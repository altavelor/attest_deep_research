import {
  applySubAgentTransition,
  type SubAgentCommand,
  type SubAgentSessionRecord,
  type SubAgentSourcePolicy,
  type SubAgentTransition,
} from "@core/research";

export const AT = "2026-10-26T10:00:00.000Z";

export function sourcePolicy(overrides: Partial<SubAgentSourcePolicy> = {}): SubAgentSourcePolicy {
  return {
    searchMode: "indexAndWeb",
    contextPaths: ["Research"],
    indexScope: "paths",
    allowActiveFile: true,
    allowNoteMutation: false,
    ...overrides,
  };
}

/** Builds a fresh ready sub-agent session record with no runs. */
export function readySubAgentRecord(sessionId = "session-1"): SubAgentSessionRecord {
  return {
    session: {
      subAgentSessionId: sessionId,
      createRequestId: `create-${sessionId}`,
      chatSessionId: "chat-1",
      parentRunId: "parent-1",
      bindingGeneration: 1,
      status: "ready",
      title: "Task",
      sourcePolicy: sourcePolicy(),
      budgetPolicy: { type: "required-scope", scopeId: "scope-1" },
      activeSubAgentRunId: null,
      pendingImportRunId: null,
      pendingImportGeneration: null,
      lastImportGeneration: 0,
      runCount: 0,
      revision: 0,
      contextSummary: null,
      evidenceRegistryId: `evidence-${sessionId}`,
      createdAt: AT,
      updatedAt: AT,
    },
    runs: [],
  };
}

/** Applies transitions in order and fails loudly on the first rejected one. */
export function applyAll(
  record: SubAgentSessionRecord,
  transitions: readonly SubAgentTransition[],
): SubAgentSessionRecord {
  return transitions.reduce((current, transition) => {
    const result = applySubAgentTransition(current, transition);
    if (!result.ok) throw new Error(`${transition.type} rejected: ${result.error.code}`);
    return result.record;
  }, record);
}

/** Lists the transitions that queue, start and finish a run up to the importing state. */
export function runToImport(
  runId: string,
  command: SubAgentCommand = { type: "initial", task: "Find X" },
): SubAgentTransition[] {
  return [
    {
      type: "command",
      command,
      origin: "direct",
      runId,
      at: AT,
      callerMode: "thinking",
    },
    { type: "scheduler-start", runId, at: AT },
    {
      type: "runner-completed",
      runId,
      at: AT,
      usage: { requestCount: 1, modelRounds: 1, toolCalls: 2, durationMs: 5, source: "provider" },
      evidenceCount: 2,
      resultSummary: `summary of ${runId}`,
    },
  ];
}
