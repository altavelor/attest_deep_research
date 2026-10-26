import type { SubAgentCloseResult } from "@application/ports/subAgent";
import { scheduleTimeout } from "@shared";
import { settleWithin } from "./deadline";
import { timestamp, type SubAgentManagerParts } from "./managerParts";
import type { SubAgentRunScheduler } from "./runScheduler";

export const CLOSE_DEADLINE_MS = 2_000;
export const PRIMARY_DRAIN_MS = 1_500;
const INTERRUPTING_REASONS = new Set(["plugin-unload"]);

interface CloseProgress {
  sessionIds: Set<string>;
  fencedRunIds: Set<string>;
  cancelledImports: { importId: string; generation: number }[];
}

/**
 * Closes every child session of a terminal parent run. The binding is revoked and all
 * parent-owned work fenced synchronously before the first await; then the archive drain
 * gets up to 1500 ms and a recovery marker the rest of one shared 2000 ms deadline.
 */
export async function closeParentRun(
  parts: SubAgentManagerParts,
  scheduler: SubAgentRunScheduler,
  parentRunId: string,
  terminalReason: string,
): Promise<SubAgentCloseResult> {
  parts.fences.revoke(parentRunId);
  const unsettled = (): number => parts.budget.unsettledKeys(progress.sessionIds).length;
  const progress: CloseProgress = {
    sessionIds: new Set(),
    fencedRunIds: new Set(),
    cancelledImports: [],
  };
  for (const record of parts.store.state?.records ?? []) {
    if (record.session.parentRunId !== parentRunId) continue;
    progress.sessionIds.add(record.session.subAgentSessionId);
    for (const runId of scheduler.fenceSession(record.session.subAgentSessionId)) {
      progress.fencedRunIds.add(runId);
    }
    parts.sessionOptions.delete(record.session.subAgentSessionId);
    for (const run of record.runs) parts.outcomes.delete(run.subAgentRunId);
  }
  if (parts.context.getChatId() === null && !parts.store.state) {
    return {
      durable: true,
      recoveryMarkerPersisted: false,
      unsettledPermits: unsettled(),
      failures: [],
    };
  }
  let expire = (): void => undefined;
  const overall = new Promise<void>((resolve) => (expire = resolve));
  const deadline = scheduleTimeout(() => expire(), CLOSE_DEADLINE_MS);
  try {
    const primary = await settleWithin(
      drain(parts, scheduler, parentRunId, terminalReason, progress),
      PRIMARY_DRAIN_MS,
    );
    if (primary.status === "done") {
      return {
        durable: true,
        recoveryMarkerPersisted: false,
        unsettledPermits: unsettled(),
        failures: [],
      };
    }
    const failures = [
      primary.status === "timeout" ? "primary-drain-timeout" : "primary-drain-failed",
    ];
    const marker = await settleWithin(
      writeMarker(parts, parentRunId, terminalReason, progress),
      CLOSE_DEADLINE_MS,
      abortOn(overall),
    );
    if (marker.status === "done") {
      return {
        durable: true,
        recoveryMarkerPersisted: true,
        unsettledPermits: unsettled(),
        failures,
      };
    }
    failures.push(
      marker.status === "failed" ? "recovery-marker-failed" : "recovery-marker-timeout",
    );
    return {
      durable: false,
      recoveryMarkerPersisted: false,
      unsettledPermits: unsettled(),
      failures,
    };
  } finally {
    deadline.cancel();
    expire();
    parts.notifyResults();
  }
}

async function drain(
  parts: SubAgentManagerParts,
  scheduler: SubAgentRunScheduler,
  parentRunId: string,
  terminalReason: string,
  progress: CloseProgress,
): Promise<void> {
  const state = await parts.store.load();
  let revision = parts.store.currentRevision;
  let closed = 0;
  const interrupted: { sessionId: string; runId: string }[] = [];
  for (const record of state.records) {
    const { session } = record;
    if (session.parentRunId !== parentRunId || session.status === "archived") continue;
    progress.sessionIds.add(session.subAgentSessionId);
    for (const runId of scheduler.fenceSession(session.subAgentSessionId)) {
      progress.fencedRunIds.add(runId);
    }
    if (session.activeSubAgentRunId) progress.fencedRunIds.add(session.activeSubAgentRunId);
    const importId = parts.store.state?.imports.find(
      (entry) =>
        entry.runId === session.pendingImportRunId &&
        entry.generation === session.pendingImportGeneration,
    )?.importId;
    if (importId && session.pendingImportGeneration !== null) {
      progress.cancelledImports.push({ importId, generation: session.pendingImportGeneration });
    }
    const activeRunId = session.activeSubAgentRunId;
    const archived = scheduler.transition(session.subAgentSessionId, {
      type: "archive",
      reason: "parent-terminal",
    });
    if (archived !== null) closed += 1;
    if (archived !== null && activeRunId && INTERRUPTING_REASONS.has(terminalReason)) {
      interrupted.push({ sessionId: session.subAgentSessionId, runId: activeRunId });
    }
    revision = archived ?? revision;
  }
  await parts.store.flush(revision);
  for (const run of interrupted)
    parts.mainEvents.interrupted(run.sessionId, run.runId, terminalReason);
  parts.mainEvents.closed(parentRunId, closed);
}

async function writeMarker(
  parts: SubAgentManagerParts,
  parentRunId: string,
  terminalReason: string,
  progress: CloseProgress,
): Promise<void> {
  const revision = parts.store.putMarker({
    parentRunId,
    terminalReason: terminalReason.trim() || "parent-terminal",
    createdAt: timestamp(parts),
    fencedRunIds: [...progress.fencedRunIds],
    cancelledImports: progress.cancelledImports,
    unresolvedActionKeys: parts.budget.unsettledKeys(progress.sessionIds),
  });
  await parts.store.flush(revision);
}

function abortOn(trigger: Promise<void>): AbortSignal {
  const controller = new AbortController();
  void trigger.then(() => controller.abort());
  return controller.signal;
}
