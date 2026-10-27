import type { ResearchMode } from "../researchMode";
import { subAgentSessionError, type SubAgentSessionError } from "./errors";
import { findOwnRun, headRun } from "./identity";
import {
  pendingImport,
  runsWithCancelledImport,
  withoutPendingImport,
  type SubAgentImportTombstone,
} from "./importState";
import type {
  NormalizedUsage,
  RetrySubAgentCommand,
  SubAgentCommand,
  SubAgentRunStatus,
  SubAgentRunSummary,
  SubAgentScopeReduction,
  SubAgentSessionRecord,
  SubAgentSessionSummary,
  SubAgentSourcePolicy,
} from "./sessionModel";
import { reduceSubAgentSourcePolicy } from "./sourcePolicy";
import { validateSubAgentTaskInput, type SubAgentTaskOrigin } from "./validation";

interface SubAgentRunLaunch {
  runId: string;
  at: string;
  callerMode: ResearchMode;
  owner?: SubAgentRunOwner;
}

export type SubAgentRunOwner = Pick<SubAgentSessionSummary, "parentRunId" | "bindingGeneration">;

interface SubAgentRunEvent {
  runId: string;
  at: string;
}

export type SubAgentTransition =
  | ({ type: "command"; command: SubAgentCommand; origin: SubAgentTaskOrigin } & SubAgentRunLaunch)
  | ({ type: "retry"; retry: RetrySubAgentCommand } & SubAgentRunLaunch)
  | ({ type: "scheduler-start" } & SubAgentRunEvent)
  | ({ type: "stop-requested" } & SubAgentRunEvent)
  | ({
      type: "runner-completed";
      usage: NormalizedUsage;
      evidenceCount: number;
      resultSummary: string | null;
    } & SubAgentRunEvent)
  | ({ type: "provider-failed"; reason: string; usage?: NormalizedUsage } & SubAgentRunEvent)
  | ({ type: "execution-denied"; reason: string } & SubAgentRunEvent)
  | ({ type: "model-stop"; reason: string } & SubAgentRunEvent)
  | { type: "import-committed" | "import-failed"; generation: number; at: string }
  | { type: "stop-import"; at: string }
  | { type: "parent-closed"; at: string }
  | {
      type: "archive";
      reason: "parent-terminal" | "user-archive" | "checkpoint-corrupt";
      at: string;
    };

export type SubAgentTransitionResult =
  | { ok: true; record: SubAgentSessionRecord; tombstonedImport: SubAgentImportTombstone | null }
  | { ok: false; error: SubAgentSessionError };

const NONTERMINAL_RUN_STATUSES: readonly SubAgentRunStatus[] = ["queued", "running", "stopping"];

const UNAVAILABLE_USAGE: NormalizedUsage = {
  requestCount: 0,
  modelRounds: 0,
  toolCalls: 0,
  durationMs: 0,
  source: "unavailable",
};

/**
 * Applies one lifecycle event to a sub-agent session record without side effects.
 * Returns the next record, with its revision incremented only for an accepted change,
 * or a session error that leaves the input record untouched.
 */
export function applySubAgentTransition(
  record: SubAgentSessionRecord,
  transition: SubAgentTransition,
): SubAgentTransitionResult {
  switch (transition.type) {
    case "command":
      return startCommand(record, transition);
    case "retry":
      return startRetry(record, transition);
    case "scheduler-start":
      return advanceActiveRun(record, transition, ["queued"], "running", {});
    case "stop-requested":
      return advanceActiveRun(record, transition, ["running"], "stopping", {});
    case "runner-completed":
      return completeRun(record, transition);
    case "provider-failed":
      return advanceActiveRun(record, transition, ["running", "stopping"], "failed", {
        terminalReason: transition.reason,
        ...(transition.usage ? { usage: transition.usage } : {}),
      });
    case "execution-denied":
      return advanceActiveRun(record, transition, ["queued"], "failed", {
        terminalReason: transition.reason,
      });
    case "model-stop":
      return advanceActiveRun(record, transition, NONTERMINAL_RUN_STATUSES, "interrupted", {
        terminalReason: transition.reason,
      });
    case "import-committed":
    case "import-failed":
      return settleImport(record, transition);
    case "stop-import":
      return record.session.status === "importing"
        ? archive(record, transition.at, null)
        : rejected("invalid-state");
    case "parent-closed":
      return closeForParent(record, transition.at);
    case "archive":
      return record.session.status === "archived"
        ? { ok: true, record, tombstonedImport: null }
        : archive(record, transition.at, transition.reason);
  }
}

function startCommand(
  record: SubAgentSessionRecord,
  transition: Extract<SubAgentTransition, { type: "command" }>,
): SubAgentTransitionResult {
  const { command, origin } = transition;
  const { session } = record;
  if (command.type === "continue-partial") {
    const head = terminalHead(record, command.fromRunId);
    if (!head.ok) return head;
    return queueRun(record, transition, command.scopeReduction, session.sourcePolicy, {
      command: command.task,
      origin,
      attempt: 1,
      continuedFromRunId: head.run.subAgentRunId,
    });
  }
  const expectsFirstRun = command.type === "initial";
  if (session.status !== "ready" || (session.runCount === 0) !== expectsFirstRun) {
    return rejected("invalid-state");
  }
  return queueRun(
    record,
    transition,
    command.type === "follow-up" ? command.scopeReduction : undefined,
    session.sourcePolicy,
    { command: command.task, origin, attempt: 1 },
  );
}

function startRetry(
  record: SubAgentSessionRecord,
  transition: Extract<SubAgentTransition, { type: "retry" }>,
): SubAgentTransitionResult {
  const head = terminalHead(record, transition.retry.runId);
  if (!head.ok) return head;
  return queueRun(
    record,
    transition,
    transition.retry.scopeReduction,
    head.run.effectiveSourcePolicy,
    {
      command: head.run.command,
      origin: head.run.origin,
      attempt: head.run.attempt + 1,
      retryOfRunId: head.run.subAgentRunId,
    },
  );
}

function terminalHead(
  record: SubAgentSessionRecord,
  runId: string,
): { ok: true; run: SubAgentRunSummary } | { ok: false; error: SubAgentSessionError } {
  const run = findOwnRun(record, runId);
  if (!run) return rejected("not-authorized");
  const { status } = record.session;
  if (
    (status !== "failed" && status !== "interrupted") ||
    headRun(record) !== run ||
    NONTERMINAL_RUN_STATUSES.includes(run.status)
  ) {
    return rejected("invalid-state");
  }
  return { ok: true, run };
}

function queueRun(
  record: SubAgentSessionRecord,
  launch: SubAgentRunLaunch,
  reduction: SubAgentScopeReduction | undefined,
  maximum: SubAgentSourcePolicy,
  lineage: Pick<SubAgentRunSummary, "command" | "origin" | "attempt"> &
    Partial<Pick<SubAgentRunSummary, "retryOfRunId" | "continuedFromRunId">>,
): SubAgentTransitionResult {
  const task = validateSubAgentTaskInput(lineage.command, lineage.origin);
  if (!task.ok) return rejected("invalid-input", { reason: task.code });
  if (record.runs.some((run) => run.subAgentRunId === launch.runId)) {
    return rejected("invalid-state");
  }
  const policy = reduceSubAgentSourcePolicy(maximum, reduction);
  if (!policy.ok) return policy;
  const { session } = record;
  const owner = launch.owner ?? session;
  const run: SubAgentRunSummary = {
    subAgentRunId: launch.runId,
    subAgentSessionId: session.subAgentSessionId,
    parentRunId: owner.parentRunId,
    callerMode: launch.callerMode,
    command: task.value,
    origin: lineage.origin,
    attempt: lineage.attempt,
    resultRevision: 0,
    status: "queued",
    phase: null,
    startedAt: null,
    completedAt: null,
    evidenceCount: 0,
    usage: UNAVAILABLE_USAGE,
    terminalReason: null,
    resultSummary: null,
    effectiveSourcePolicy: policy.policy,
    retryOfRunId: lineage.retryOfRunId ?? null,
    continuedFromRunId: lineage.continuedFromRunId ?? null,
    budgetScopeId:
      session.budgetPolicy.type === "required-scope" ? session.budgetPolicy.scopeId : null,
  };
  const tombstone = pendingImport(session);
  return accepted(
    { session, runs: [...runsWithCancelledImport(record), run] },
    {
      ...withoutPendingImport(session),
      parentRunId: owner.parentRunId,
      bindingGeneration: owner.bindingGeneration,
      status: "queued",
      activeSubAgentRunId: run.subAgentRunId,
      runCount: session.runCount + 1,
    },
    launch.at,
    tombstone,
  );
}

function advanceActiveRun(
  record: SubAgentSessionRecord,
  event: SubAgentRunEvent,
  from: readonly SubAgentRunStatus[],
  to: SubAgentRunStatus,
  patch: Partial<SubAgentRunSummary>,
): SubAgentTransitionResult {
  const run = activeRun(record, event.runId);
  if (!run || !from.includes(run.status)) return rejected("invalid-state");
  const terminal = !NONTERMINAL_RUN_STATUSES.includes(to);
  const next: SubAgentRunSummary = {
    ...run,
    ...patch,
    status: to,
    ...(to === "running" ? { startedAt: event.at } : {}),
    ...(terminal
      ? { completedAt: event.at, phase: null, resultRevision: run.resultRevision + 1 }
      : {}),
  };
  return accepted(
    replaceRun(record, next),
    {
      ...record.session,
      status: to === "completed" ? "importing" : to,
      activeSubAgentRunId: terminal ? null : run.subAgentRunId,
    },
    event.at,
    null,
  );
}

function completeRun(
  record: SubAgentSessionRecord,
  event: Extract<SubAgentTransition, { type: "runner-completed" }>,
): SubAgentTransitionResult {
  const run = activeRun(record, event.runId);
  if (!run || run.status !== "running") return rejected("invalid-state");
  const { session } = record;
  if (!Number.isSafeInteger(session.lastImportGeneration + 1))
    return rejected("checkpoint-corrupt");
  return accepted(
    replaceRun(record, {
      ...run,
      status: "completed",
      phase: null,
      completedAt: event.at,
      usage: event.usage,
      evidenceCount: event.evidenceCount,
      resultSummary: event.resultSummary,
    }),
    {
      ...session,
      status: "importing",
      activeSubAgentRunId: null,
      pendingImportRunId: run.subAgentRunId,
      pendingImportGeneration: session.lastImportGeneration + 1,
    },
    event.at,
    null,
  );
}

function settleImport(
  record: SubAgentSessionRecord,
  event: Extract<SubAgentTransition, { type: "import-committed" | "import-failed" }>,
): SubAgentTransitionResult {
  const { session } = record;
  const run = session.pendingImportRunId
    ? findOwnRun(record, session.pendingImportRunId)
    : undefined;
  const allowedStatus =
    session.status === "importing" ||
    (event.type === "import-committed" && session.status === "failed");
  if (!run || !allowedStatus || session.pendingImportGeneration !== event.generation) {
    return rejected("invalid-state");
  }
  const runs = replaceRun(record, { ...run, resultRevision: run.resultRevision + 1 }).runs;
  if (event.type === "import-failed") {
    return accepted({ session, runs }, { ...session, status: "failed" }, event.at, null);
  }
  return accepted(
    { session, runs },
    {
      ...withoutPendingImport(session),
      status: "ready",
      lastImportGeneration: event.generation,
      contextSummary: run.resultSummary ?? session.contextSummary,
    },
    event.at,
    null,
  );
}

function archive(
  record: SubAgentSessionRecord,
  at: string,
  reason: string | null,
): SubAgentTransitionResult {
  return endWork(record, at, reason, "archived");
}

function closeForParent(record: SubAgentSessionRecord, at: string): SubAgentTransitionResult {
  const { session } = record;
  if (session.status === "archived") return rejected("invalid-state");
  const working = session.activeSubAgentRunId !== null || session.pendingImportRunId !== null;
  if (!working) return { ok: true, record, tombstonedImport: null };
  return endWork(record, at, "parent-terminal", "interrupted");
}

function endWork(
  record: SubAgentSessionRecord,
  at: string,
  reason: string | null,
  status: "archived" | "interrupted",
): SubAgentTransitionResult {
  const runs = runsWithCancelledImport(record).map((run) =>
    NONTERMINAL_RUN_STATUSES.includes(run.status)
      ? {
          ...run,
          status: "interrupted" as const,
          phase: null,
          completedAt: at,
          terminalReason: reason,
          resultRevision: run.resultRevision + 1,
        }
      : run,
  );
  return accepted(
    { session: record.session, runs },
    { ...withoutPendingImport(record.session), status, activeSubAgentRunId: null },
    at,
    pendingImport(record.session),
  );
}

function activeRun(record: SubAgentSessionRecord, runId: string): SubAgentRunSummary | undefined {
  return record.session.activeSubAgentRunId === runId ? findOwnRun(record, runId) : undefined;
}

function replaceRun(
  record: SubAgentSessionRecord,
  next: SubAgentRunSummary,
): SubAgentSessionRecord {
  return {
    session: record.session,
    runs: record.runs.map((run) => (run.subAgentRunId === next.subAgentRunId ? next : run)),
  };
}

function accepted(
  record: SubAgentSessionRecord,
  session: SubAgentSessionSummary,
  at: string,
  tombstonedImport: SubAgentImportTombstone | null,
): SubAgentTransitionResult {
  return {
    ok: true,
    record: {
      runs: record.runs,
      session: { ...session, revision: record.session.revision + 1, updatedAt: at },
    },
    tombstonedImport,
  };
}

function rejected(
  code: Parameters<typeof subAgentSessionError>[0],
  details?: Parameters<typeof subAgentSessionError>[1],
): { ok: false; error: SubAgentSessionError } {
  return { ok: false, error: subAgentSessionError(code, details) };
}
