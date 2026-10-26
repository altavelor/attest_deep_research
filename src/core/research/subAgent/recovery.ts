import type { SubAgentRunSummary, SubAgentSessionRecord } from "./sessionModel";
import type { SubAgentRecoveryMarker, SubAgentStateSnapshot } from "./stateSnapshot";

const CRASH_RECOVERY = "crash-recovery";

/**
 * Applies startup recovery to a persisted section: every queued, running or stopping
 * run becomes interrupted with reason crash-recovery and every session not yet
 * archived is archived, because no parent run survives a restart. Each affected
 * parent gets a recovery marker listing fenced runs, cancelled pending imports and
 * unsettled action keys; pending creates, imports and permits stay for later
 * reconciliation and no parent binding is created.
 */
export function recoverSubAgentState(
  snapshot: SubAgentStateSnapshot,
  completedAt: string,
): SubAgentStateSnapshot {
  const markers = new Map<string, SubAgentRecoveryMarker>();
  const records = snapshot.records.map((record) => {
    if (record.session.status === "archived") return record;
    return archiveRecord(snapshot, record, completedAt, markers);
  });
  if (markers.size === 0) return snapshot;
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    records,
    recoveryMarkers: [...snapshot.recoveryMarkers, ...markers.values()],
  };
}

function archiveRecord(
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
        entry.runId === session.pendingImportRunId,
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
      status: "archived",
      activeSubAgentRunId: null,
      pendingImportRunId: null,
      pendingImportGeneration: null,
      revision: session.revision + 1,
      updatedAt: completedAt,
    },
    runs,
  };
}
