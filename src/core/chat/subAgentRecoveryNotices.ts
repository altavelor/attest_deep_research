import {
  deriveSubAgentTitle,
  subAgentNoticeKey,
  type SubAgentDispatchEntry,
  type SubAgentStateSnapshot,
} from "@core/research/subAgent";
import {
  applySubAgentTimelineEvent,
  type SubAgentTimelineEvent,
  type SubAgentTimelineState,
} from "./subAgentTimeline";

const CRASH_RECOVERY = "crash-recovery";

/**
 * Adds one interrupted notice per direct run that startup recovery cut off. Runs already
 * terminal or of sessions archived before recovery get none, the description comes only
 * from the saved, already redacted dispatch body, and a known event key adds nothing.
 */
export function withCrashRecoveryNotices(
  state: SubAgentTimelineState,
  chatId: string,
  before: SubAgentStateSnapshot,
  after: SubAgentStateSnapshot,
  createdAt: string,
): SubAgentTimelineState {
  let next = state;
  for (const event of recoveryEvents(state.subAgentDispatches, chatId, before, after, createdAt)) {
    next = applySubAgentTimelineEvent(next, event) ?? next;
  }
  return next;
}

function recoveryEvents(
  dispatches: readonly SubAgentDispatchEntry[],
  chatId: string,
  before: SubAgentStateSnapshot,
  after: SubAgentStateSnapshot,
  createdAt: string,
): SubAgentTimelineEvent[] {
  const previous = new Map(
    before.records.flatMap((record) => record.runs.map((run) => [run.subAgentRunId, run.status])),
  );
  return after.records.flatMap((record) => {
    const { session } = record;
    return record.runs.flatMap((run): SubAgentTimelineEvent[] => {
      const was = previous.get(run.subAgentRunId);
      const cutOff = was === "queued" || was === "running" || was === "stopping";
      if (!cutOff || run.status !== "interrupted" || run.origin !== "direct") return [];
      const body = dispatches.find((entry) => entry.runId === run.subAgentRunId)?.body;
      return [
        {
          type: "notice",
          entry: {
            eventKey: subAgentNoticeKey(
              chatId,
              session.parentRunId,
              session.subAgentSessionId,
              run.subAgentRunId,
              "interrupted",
            ),
            parentRunId: session.parentRunId,
            description: body === undefined ? "" : deriveSubAgentTitle(body),
            createdAt,
            sessionId: session.subAgentSessionId,
            runId: run.subAgentRunId,
            kind: "interrupted",
            reasonCode: CRASH_RECOVERY,
          },
        },
      ];
    });
  });
}
