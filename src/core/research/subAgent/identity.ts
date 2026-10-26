import { condenseTitleText } from "@core/chat/titlePolicy";
import type {
  ParentRunBinding,
  SubAgentRunSummary,
  SubAgentSessionRecord,
  SubAgentSessionSummary,
} from "./sessionModel";

const UNSAFE_TITLE_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Derives a display title from a sub-agent task with the shared chat title policy.
 * Control and bidirectional-override characters are removed first; the validated task
 * itself is stored unchanged elsewhere.
 */
export function deriveSubAgentTitle(task: string): string {
  return condenseTitleText(task.replace(UNSAFE_TITLE_CHARACTERS, "")) || "Untitled sub-agent";
}

/** True when the session belongs to exactly this chat, parent run and binding generation. */
export function isBoundToParentRun(
  session: SubAgentSessionSummary,
  binding: ParentRunBinding,
): boolean {
  return (
    session.chatSessionId === binding.chatSessionId &&
    session.parentRunId === binding.parentRunId &&
    session.bindingGeneration === binding.bindingGeneration
  );
}

/** Finds a run that belongs to the record's own session, ignoring foreign run summaries. */
export function findOwnRun(
  record: SubAgentSessionRecord,
  runId: string,
): SubAgentRunSummary | undefined {
  return record.runs.find(
    (run) =>
      run.subAgentRunId === runId && run.subAgentSessionId === record.session.subAgentSessionId,
  );
}

/** Returns the latest run of the session, which is the only one retry or continuation may reference. */
export function headRun(record: SubAgentSessionRecord): SubAgentRunSummary | undefined {
  return record.runs[record.runs.length - 1];
}
