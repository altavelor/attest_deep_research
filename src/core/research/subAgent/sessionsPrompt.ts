import { deriveSubAgentTitle, headRun } from "./identity";
import type { SubAgentSessionRecord } from "./sessionModel";

export const MAX_PROMPT_SESSIONS = 20;

export type SubAgentPromptSessionState =
  "idle" | "running" | "finished" | "failed" | "interrupted" | "stopped";

export interface SubAgentPromptSession {
  sessionId: string;
  title: string;
  state: SubAgentPromptSessionState;
  lastRunId: string | null;
  attempt: number | null;
}

/**
 * Lists the chat's directly delegated sessions, newest first and at most twenty, with
 * host-owned fields only. Titles are re-derived and stripped of angle brackets, and
 * map_sources worker sessions and other chats' sessions are left out.
 */
export function listSubAgentPromptSessions(
  records: readonly SubAgentSessionRecord[],
  chatId: string,
): SubAgentPromptSession[] {
  return records
    .filter(
      (record) =>
        record.session.chatSessionId === chatId && record.runs[0]?.origin !== "map_sources",
    )
    .sort((left, right) => right.session.updatedAt.localeCompare(left.session.updatedAt))
    .slice(0, MAX_PROMPT_SESSIONS)
    .map((record) => {
      const head = headRun(record);
      return {
        sessionId: record.session.subAgentSessionId,
        title: deriveSubAgentTitle(record.session.title.replace(/[<>]/g, " ")),
        state: promptState(record),
        lastRunId: head?.subAgentRunId ?? null,
        attempt: head?.attempt ?? null,
      };
    });
}

/** Renders the sessions as one line each for the parent's system prompt. */
export function buildSubAgentSessionsSection(sessions: readonly SubAgentPromptSession[]): string {
  return [
    "## Sub-agent sessions of this chat",
    "Pass a sessionId to run_subagent to continue that session from this turn: follow-up when " +
      "finished or idle, retry or continue-partial with the last run when failed or interrupted. " +
      "Read results with get_subagent_result.",
    ...sessions.map(
      (session) =>
        `- ${session.sessionId} · ${session.title} · ${session.state}` +
        (session.lastRunId === null
          ? ""
          : ` · last run ${session.lastRunId} attempt ${session.attempt}`),
    ),
  ].join("\n");
}

function promptState(record: SubAgentSessionRecord): SubAgentPromptSessionState {
  switch (record.session.status) {
    case "ready":
      return record.session.runCount === 0 ? "idle" : "finished";
    case "failed":
    case "interrupted":
      return record.session.status;
    case "archived":
      return "stopped";
    default:
      return "running";
  }
}
