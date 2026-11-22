import type { SubAgentRunSummary, SubAgentSessionRecord } from "./sessionModel";
import type { SubAgentRecoveryMarker, SubAgentStateSnapshot } from "./stateSnapshot";
import { recoverMapSourcesBatches } from "./batchState";

const CRASH_RECOVERY = "crash-recovery";

/**
 * Applies startup recovery to a persisted section: every queued, running or stopping
 * run becomes interrupted with reason crash-recovery and a session whose work was cut
 * off becomes interrupted, staying continuable by the next parent run. Each affected
 * parent gets a recovery marker listing fenced runs, cancelled pending imports and
 * unsettled action keys and its pending imports are tombstoned; pending creates and
 * permits stay for later reconciliation and no parent binding is created. Preparing and
 * pending map_sources batches become interrupted with a safe crash-recovery error.
 */
export function recoverSubAgentState(
  snapshot: SubAgentStateSnapshot,
  completedAt: string,
): SubAgentStateSnapshot {
  const markers = new Map<string, SubAgentRecoveryMarker>();
  const records = snapshot.records.map((record) => {
    const { session } = record;
    if (session.activeSubAgentRunId === null && session.pendingImportRunId === null) return record;
    return interruptRecord(snapshot, record, completedAt, markers);
  });
  const recovered = recoverMapSourcesBatches(snapshot.batches);
  const batches = recovered.changed ? { batches: recovered.batches } : {};
  if (markers.size === 0) {
    return recovered.changed
      ? { ...snapshot, ...batches, revision: snapshot.revision + 1 }
      : snapshot;
  }
  const cancelled = new Set(
    [...markers.values()].flatMap((marker) =>
      marker.cancelledImports.map((entry) => entry.importId),
    ),
  );
  return {
    ...snapshot,
    ...batches,
    revision: snapshot.revision + 1,
    records,
    imports: snapshot.imports.map((entry) =>
      cancelled.has(entry.importId)
        ? { ...entry, state: "tombstoned" as const, tombstoneReason: CRASH_RECOVERY }
        : entry,
    ),
    recoveryMarkers: [...snapshot.recoveryMarkers, ...markers.values()],
  };
}

function interruptRecord(
  snapshot: SubAgentStateSnapshot,
  record: SubAgentSessionRecord,
  completedAt: string,
  markers: Map<string, SubAgentRecoveryMarker>,
): SubAgentSessionRecord {
  const { session } = record;
  const fenced: string[] = [];
  const runs = record.runs.map((run): SubAgentRunSummary => {
    if (run.status !== "queued" && run.status !== "running" && run.status !== "stopping") {
      return run;
    }
    fenced.push(run.subAgentRunId);
    return { ...run, status: "interrupted", terminalReason: CRASH_RECOVERY, completedAt };
  });
  const cancelledImports = snapshot.imports
    .filter(
      (entry) =>
        entry.state === "prepared" &&
        entry.sessionId === session.subAgentSessionId &&
        entry.runId === session.pendingImportRunId &&
        entry.generation === session.pendingImportGeneration,
    )
    .map((entry) => ({ importId: entry.importId, generation: entry.generation }));
  const unresolvedActionKeys = snapshot.pendingActions
    .filter(
      (action) => action.sessionId === session.subAgentSessionId && action.state !== "settled",
    )
    .map((action) => action.actionKey);
  const marker = markers.get(session.parentRunId) ?? {
    parentRunId: session.parentRunId,
    terminalReason: CRASH_RECOVERY,
    createdAt: completedAt,
    fencedRunIds: [],
    cancelledImports: [],
    unresolvedActionKeys: [],
  };
  markers.set(session.parentRunId, {
    ...marker,
    fencedRunIds: [...marker.fencedRunIds, ...fenced],
    cancelledImports: [...marker.cancelledImports, ...cancelledImports],
    unresolvedActionKeys: [...marker.unresolvedActionKeys, ...unresolvedActionKeys],
  });
  return {
    session: {
      ...session,
      status: "interrupted",
      activeSubAgentRunId: null,
      pendingImportRunId: null,
      pendingImportGeneration: null,
      revision: session.revision + 1,
      updatedAt: completedAt,
    },
    runs,
  };
}
