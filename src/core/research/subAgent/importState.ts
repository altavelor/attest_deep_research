import type {
  SubAgentRunSummary,
  SubAgentSessionRecord,
  SubAgentSessionSummary,
} from "./sessionModel";

export interface SubAgentImportTombstone {
  runId: string;
  generation: number;
}

export function pendingImport(session: SubAgentSessionSummary): SubAgentImportTombstone | null {
  return session.pendingImportRunId !== null && session.pendingImportGeneration !== null
    ? { runId: session.pendingImportRunId, generation: session.pendingImportGeneration }
    : null;
}

export function withoutPendingImport(session: SubAgentSessionSummary): SubAgentSessionSummary {
  return {
    ...session,
    pendingImportRunId: null,
    pendingImportGeneration: null,
    lastImportGeneration: Math.max(
      session.lastImportGeneration,
      session.pendingImportGeneration ?? 0,
    ),
  };
}

/**
 * Returns the runs of a record with the result revision of the run whose pending import is
 * being cancelled advanced, because its public result changes from import-failed to cancelled.
 */
export function runsWithCancelledImport(
  record: SubAgentSessionRecord,
): readonly SubAgentRunSummary[] {
  const { pendingImportRunId } = record.session;
  return record.runs.map((run) =>
    run.subAgentRunId === pendingImportRunId
      ? { ...run, resultRevision: run.resultRevision + 1 }
      : run,
  );
}
