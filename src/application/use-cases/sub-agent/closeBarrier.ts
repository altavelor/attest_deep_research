import type { SubAgentCloseResult } from "@application/ports/subAgent";
import type { SubAgentSessionSummary } from "@core/research";
import { scheduleTimeout } from "@shared";
import { settleWithin } from "./deadline";
import { timestamp, type SubAgentManagerParts, type UnsavedImport } from "./managerParts";
import type { SubAgentRunScheduler } from "./runScheduler";
import { restoreUnsavedImport, takeUnsavedImport } from "./unsavedImports";

export const CLOSE_DEADLINE_MS = 2_000;
export const PRIMARY_DRAIN_MS = 1_500;
const INTERRUPTING_REASONS = new Set(["plugin-unload", "finalize-timeout"]);

interface CloseProgress {
  sessionIds: Set<string>;
  fencedRunIds: Set<string>;
  cancelledImports: { importId: string; generation: number }[];
  withdrawnImports: UnsavedImport[];
}

/**
 * Ends the work of a terminal parent run while its sessions stay continuable by later runs
 * of the chat. The binding is revoked, an unsaved import withdrawn from publication and
 * all parent-owned work fenced synchronously before the first await; then the interrupting drain
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
    withdrawnImports: [],
  };
  for (const record of parts.store.state?.records ?? []) {
    if (record.session.parentRunId !== parentRunId) continue;
    const withdrawn = takeUnsavedImport(parts, record.session.subAgentSessionId);
    if (withdrawn) {
      progress.withdrawnImports.push(withdrawn);
      cancelPendingImport(parts, progress, withdrawn.before.session);
    }
    progress.sessionIds.add(record.session.subAgentSessionId);
    for (const runId of scheduler.fenceSession(record.session.subAgentSessionId)) {
      progress.fencedRunIds.add(runId);
    }
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
  for (const withdrawn of progress.withdrawnImports.splice(0)) {
    restoreUnsavedImport(parts, withdrawn);
  }
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
    cancelPendingImport(parts, progress, session);
    const activeRunId = session.activeSubAgentRunId;
    if (activeRunId === null && session.pendingImportRunId === null) continue;
    const ended = scheduler.transition(session.subAgentSessionId, { type: "parent-closed" });
    if (ended !== null) closed += 1;
    if (ended !== null && activeRunId && INTERRUPTING_REASONS.has(terminalReason)) {
      interrupted.push({ sessionId: session.subAgentSessionId, runId: activeRunId });
    }
    revision = ended ?? revision;
  }
  await parts.store.flush(revision);
  for (const run of interrupted)
    parts.mainEvents.interrupted(run.sessionId, run.runId, terminalReason);
  parts.mainEvents.closed(parentRunId, closed);
}

function cancelPendingImport(
  parts: SubAgentManagerParts,
  progress: CloseProgress,
  session: SubAgentSessionSummary,
): void {
  const generation = session.pendingImportGeneration;
  const importId = parts.store.state?.imports.find(
    (entry) => entry.runId === session.pendingImportRunId && entry.generation === generation,
  )?.importId;
  if (!importId || generation === null) return;
  if (progress.cancelledImports.some((entry) => entry.importId === importId)) return;
  progress.cancelledImports.push({ importId, generation });
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
