import type { QueuedRun, RunSlot, SubAgentRunScheduler, TransitionEvent } from "./runScheduler";

/** Fails a queued run that may not start, so it never runs without its limits or permit. */
export async function denyRun(
  scheduler: SubAgentRunScheduler,
  entry: QueuedRun,
  reason: string,
): Promise<void> {
  const { parts } = scheduler;
  try {
    const revision = scheduler.transition(entry.sessionId, {
      type: "execution-denied",
      runId: entry.runId,
      reason,
    });
    if (revision === null) return;
    await parts.store.flush(revision);
  } catch {
    return;
  }
  parts.mainEvents.terminal(entry.sessionId, entry.runId, "not-started");
  parts.notifyResults();
}

/** Stages a terminal or import transition, waits for it to be durable and then notifies. */
export async function settleRun(
  scheduler: SubAgentRunScheduler,
  slot: RunSlot,
  event: TransitionEvent,
): Promise<boolean> {
  const { parts } = scheduler;
  try {
    const revision = scheduler.transition(slot.sessionId, event);
    if (revision === null) return false;
    await parts.store.flush(revision);
  } catch {
    return false;
  }
  const kind = event.type === "import-failed" ? "import-failed" : "failed";
  parts.mainEvents.terminal(slot.sessionId, slot.runId, kind);
  parts.notifyResults();
  return true;
}

/** Fails an import whose completed result could not be saved, so the session never hangs in importing. */
export async function abandonRunImport(
  scheduler: SubAgentRunScheduler,
  slot: QueuedRun,
  generation: number,
): Promise<void> {
  const { parts } = scheduler;
  const session = parts.store.record(slot.sessionId)?.session;
  if (session?.status !== "importing" || session.pendingImportRunId !== slot.runId) return;
  const closed = parts.fences.isRevoked(session.parentRunId);
  try {
    const revision = scheduler.transition(
      slot.sessionId,
      closed ? { type: "parent-closed" } : { type: "import-failed", generation },
    );
    if (revision === null) return;
    await parts.store.flush(revision);
  } catch {
    parts.notifyResults();
    return;
  }
  if (closed) return parts.notifyResults();
  parts.mainEvents.terminal(slot.sessionId, slot.runId, "import-failed");
  parts.notifyResults();
}
