import type { SubAgentSessionRecord } from "@core/research";
import type { SubAgentManagerParts } from "./managerParts";
import type { SubAgentRunScheduler } from "./runScheduler";

/** Fences and terminates the session's current queued, running or importing work; null when idle. */
export function stopSessionWork(
  scheduler: SubAgentRunScheduler,
  record: SubAgentSessionRecord,
  reason: string,
): number | null {
  const { session } = record;
  scheduler.fenceSession(session.subAgentSessionId);
  if (session.status === "importing") {
    return scheduler.transition(session.subAgentSessionId, { type: "stop-import" });
  }
  if (session.activeSubAgentRunId === null) return null;
  return scheduler.transition(session.subAgentSessionId, {
    type: "model-stop",
    runId: session.activeSubAgentRunId,
    reason,
  });
}

/**
 * Cleans up a closed budget scope once its cleanup claim was won: every session of the
 * scope is fenced, its queued or running work is terminated and the terminal states are
 * published, while sessions of other scopes stay untouched.
 */
export async function closeBudgetScope(
  parts: SubAgentManagerParts,
  scheduler: SubAgentRunScheduler,
  scopeId: string,
): Promise<void> {
  let revision: number | null = null;
  const stopped: { sessionId: string; runId: string }[] = [];
  for (const record of parts.store.state?.records ?? []) {
    const policy = record.session.budgetPolicy;
    if (policy.type !== "required-scope" || policy.scopeId !== scopeId) continue;
    const { session } = record;
    const runId = session.activeSubAgentRunId ?? session.pendingImportRunId;
    try {
      const stop = stopSessionWork(scheduler, record, "budget-denied");
      if (stop === null) continue;
      revision = stop;
      if (runId) stopped.push({ sessionId: session.subAgentSessionId, runId });
    } catch {
      continue;
    }
  }
  if (revision === null) return;
  const durable = await parts.store.flush(revision).then(
    () => true,
    () => false,
  );
  if (durable) {
    for (const run of stopped) parts.mainEvents.terminal(run.sessionId, run.runId, "stopped");
  }
  parts.notifyResults();
}
