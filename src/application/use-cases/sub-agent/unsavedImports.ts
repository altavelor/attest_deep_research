import type { SubAgentSessionRecord } from "@core/research";
import type { SubAgentManagerParts } from "./managerParts";

/** Returns the record public views must show: the pre-commit record while a run's import write is pending. */
export function publishedRecord(
  parts: SubAgentManagerParts,
  record: SubAgentSessionRecord,
): SubAgentSessionRecord {
  for (const run of record.runs) {
    const unsaved = parts.unsavedImports.get(run.subAgentRunId);
    if (unsaved) return unsaved.before;
  }
  return record;
}

/** Restores the importing record and prepared marker of a session's pending import write; false when none is pending. */
export function revertUnsavedImport(parts: SubAgentManagerParts, sessionId: string): boolean {
  for (const [runId, unsaved] of parts.unsavedImports) {
    if (unsaved.before.session.subAgentSessionId !== sessionId) continue;
    parts.unsavedImports.delete(runId);
    parts.store.putRecord(unsaved.before);
    if (unsaved.marker) parts.imports.unmarkCommitted(unsaved.marker);
    return true;
  }
  return false;
}
