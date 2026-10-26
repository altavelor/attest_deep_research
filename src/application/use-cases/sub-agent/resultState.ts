import {
  subAgentSessionError,
  type ImportedSubAgentRunOutcome,
  type SubAgentResultError,
  type SubAgentResultState,
  type SubAgentRunSummary,
  type SubAgentSessionRecord,
} from "@core/research";
import type { SubAgentManagerParts } from "./managerParts";

const RUN_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  "provider-failed": "Дочерний агент завершился с ошибкой.",
  "scheduler-start-failed": "Не удалось запустить дочернего агента.",
  "acceptance-failed": "Команда дочернему агенту не была сохранена.",
  "execution-denied": "Запуск дочернего агента отклонён.",
  stopped: "Дочерний агент остановлен.",
  "parent-terminal": "Родительский запуск завершён.",
  "import-cancelled": "Импорт результата дочернего агента отменён.",
};

/** Returns the committed import outcome of a run from memory or from its committed import record. */
export function committedOutcome(
  parts: SubAgentManagerParts,
  record: SubAgentSessionRecord,
  run: SubAgentRunSummary,
): ImportedSubAgentRunOutcome | undefined {
  const cached = parts.outcomes.get(run.subAgentRunId);
  if (cached) return cached;
  const entry = parts.store.state?.imports.find(
    (row) =>
      row.state === "committed" &&
      row.runId === run.subAgentRunId &&
      row.sessionId === record.session.subAgentSessionId,
  );
  return entry
    ? { run, answerText: entry.answerText, evidence: entry.aliases, importId: entry.importId }
    : undefined;
}

/**
 * Maps a run to its public result state without waiting on the model. A completed run
 * is public success only with a committed import outcome; while its import is pending it
 * stays pending without its summary, a failed import reads as import-failed and a
 * cancelled one as interrupted.
 */
export function resultStateOf(
  parts: SubAgentManagerParts,
  record: SubAgentSessionRecord,
  run: SubAgentRunSummary,
): SubAgentResultState {
  const resultRevision = run.resultRevision;
  if (run.status === "failed" || run.status === "interrupted") {
    const fallback = run.status === "failed" ? "provider-failed" : "stopped";
    return {
      state: run.status,
      resultRevision,
      run,
      error: runError(run.terminalReason ?? fallback),
    };
  }
  if (run.status !== "completed") return { state: "pending", resultRevision, run };
  if (parts.unsavedImports.has(run.subAgentRunId)) {
    return { state: "pending", resultRevision, run: { ...run, resultSummary: null } };
  }
  const outcome = committedOutcome(parts, record, run);
  if (outcome) return { state: "completed", resultRevision, outcome };
  const { session } = record;
  const unimported: SubAgentRunSummary = { ...run, resultSummary: null };
  if (session.pendingImportRunId === run.subAgentRunId && session.status === "importing") {
    return { state: "pending", resultRevision, run: unimported };
  }
  if (session.pendingImportRunId === run.subAgentRunId && session.status === "failed") {
    const error = subAgentSessionError("import-failed");
    return {
      state: "failed",
      resultRevision,
      run: unimported,
      error: { code: error.code, message: error.message },
    };
  }
  return {
    state: "interrupted",
    resultRevision,
    run: unimported,
    error: runError("import-cancelled"),
  };
}

function runError(code: string): SubAgentResultError {
  return { code, message: RUN_FAILURE_MESSAGES[code] ?? RUN_FAILURE_MESSAGES["provider-failed"] };
}
