import type { SubAgentCloseResult } from "@application/ports/subAgent";
import { scheduleTimeout } from "@shared";
import { settleWithin } from "./deadline";
import { timestamp, type SubAgentManagerParts } from "./managerParts";
import type { SubAgentRunScheduler } from "./runScheduler";

export const CLOSE_DEADLINE_MS = 2_000;
export const PRIMARY_DRAIN_MS = 1_500;

interface CloseProgress {
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
  const progress: CloseProgress = { fencedRunIds: new Set(), cancelledImports: [] };
  for (const record of parts.store.state?.records ?? []) {
    if (record.session.parentRunId !== parentRunId) continue;
    for (const runId of scheduler.fenceSession(record.session.subAgentSessionId)) {
      progress.fencedRunIds.add(runId);
    }
  }
  if (parts.context.getChatId() === null && !parts.store.state) {
    return { durable: true, recoveryMarkerPersisted: false, unsettledPermits: 0, failures: [] };
  }
  let expire = (): void => undefined;
  const overall = new Promise<void>((resolve) => (expire = resolve));
  const deadline = scheduleTimeout(() => expire(), CLOSE_DEADLINE_MS);
  try {
    const primary = await settleWithin(
      drain(parts, scheduler, parentRunId, progress),
      PRIMARY_DRAIN_MS,
    );
    if (primary.status === "done") {
      return { durable: true, recoveryMarkerPersisted: false, unsettledPermits: 0, failures: [] };
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
      return { durable: true, recoveryMarkerPersisted: true, unsettledPermits: 0, failures };
    }
    failures.push(
      marker.status === "failed" ? "recovery-marker-failed" : "recovery-marker-timeout",
    );
    return { durable: false, recoveryMarkerPersisted: false, unsettledPermits: 0, failures };
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
  progress: CloseProgress,
): Promise<void> {
  const state = await parts.store.load();
  let revision = parts.store.currentRevision;
  for (const record of state.records) {
    const { session } = record;
    if (session.parentRunId !== parentRunId || session.status === "archived") continue;
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
    revision =
      scheduler.transition(session.subAgentSessionId, {
        type: "archive",
        reason: "parent-terminal",
      }) ?? revision;
  }
  await parts.store.flush(revision);
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
    unresolvedActionKeys: [],
  });
  await parts.store.flush(revision);
}

function abortOn(trigger: Promise<void>): AbortSignal {
  const controller = new AbortController();
  void trigger.then(() => controller.abort());
  return controller.signal;
}
