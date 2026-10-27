import { answerMessageId } from "@core/conversation/messageIds";
import type { ChainItem, ChatDisplayMessage } from "@core/conversation/model";
import type {
  SubAgentDispatchEntry,
  SubAgentNoticeEntry,
  SubAgentNoticeKind,
} from "@core/research/subAgent";
import { isTimelineSequence } from "./chainSequence";

export type SubAgentRunStatus =
  | "running"
  | "queued"
  | Extract<
      SubAgentNoticeKind,
      | "finished"
      | "partial"
      | "failed"
      | "stopped"
      | "interrupted"
      | "import-failed"
      | "not-started"
    >;

export type ParentTimelineEvent =
  | {
      kind: "agent-dispatch";
      sequence: number;
      dispatch: SubAgentDispatchEntry;
      title: string;
      status: SubAgentRunStatus;
    }
  | { kind: "agent-notice"; sequence: number; notice: SubAgentNoticeEntry };

export interface SubAgentEventPlacement {
  byMessageId: ReadonlyMap<string, readonly ParentTimelineEvent[]>;
  orphanDispatches: SubAgentDispatchEntry[];
  orphanNotices: SubAgentNoticeEntry[];
}

export type WorkflowEntry =
  { type: "item"; item: ChainItem } | { type: "event"; event: ParentTimelineEvent };

const TERMINAL_KINDS = new Set<SubAgentNoticeKind>([
  "finished",
  "partial",
  "failed",
  "stopped",
  "interrupted",
  "import-failed",
  "not-started",
]);

/**
 * Assigns each dispatch and notice to the assistant message of its parent run, in
 * ascending sequence. Events whose run has no rendered message stay orphans, so the
 * transcript can still show them on their own instead of dropping them.
 */
export function placeSubAgentEvents(
  messages: readonly ChatDisplayMessage[],
  dispatches: readonly SubAgentDispatchEntry[],
  notices: readonly SubAgentNoticeEntry[],
): SubAgentEventPlacement {
  const ids = new Set(messages.map((message) => message.id).filter(Boolean));
  const byMessageId = new Map<string, ParentTimelineEvent[]>();
  const placement = {
    byMessageId,
    orphanDispatches: [] as SubAgentDispatchEntry[],
    orphanNotices: [] as SubAgentNoticeEntry[],
  };
  const place = (parentRunId: string, event: ParentTimelineEvent): boolean => {
    const id = answerMessageId(parentRunId);
    if (!ids.has(id)) return false;
    byMessageId.set(id, [...(byMessageId.get(id) ?? []), event]);
    return true;
  };
  for (const dispatch of dispatches) {
    const event = dispatchEvent(dispatch, notices);
    if (!place(dispatch.parentRunId, event)) placement.orphanDispatches.push(dispatch);
  }
  for (const notice of notices) {
    const event = { kind: "agent-notice" as const, sequence: notice.sequence, notice };
    if (!place(notice.parentRunId, event)) placement.orphanNotices.push(notice);
  }
  for (const events of byMessageId.values()) events.sort((a, b) => a.sequence - b.sequence);
  return placement;
}

/** Decorates a dispatch with the agent title and the live status derived from the notices. */
export function dispatchEvent(
  dispatch: SubAgentDispatchEntry,
  notices: readonly SubAgentNoticeEntry[],
): Extract<ParentTimelineEvent, { kind: "agent-dispatch" }> {
  return {
    kind: "agent-dispatch",
    sequence: dispatch.sequence,
    dispatch,
    title: agentTitle(dispatch.sessionId, notices),
    status: subAgentRunStatus(dispatch, notices),
  };
}

/**
 * A run's status is its latest terminal notice, else queued while a queued notice names
 * the same run, and running otherwise. The manager always emits queued with its run, so a
 * run-less queued notice never marks another run of the session as queued.
 */
export function subAgentRunStatus(
  dispatch: Pick<SubAgentDispatchEntry, "runId">,
  notices: readonly SubAgentNoticeEntry[],
): SubAgentRunStatus {
  const terminal = notices
    .filter((notice) => notice.runId === dispatch.runId && TERMINAL_KINDS.has(notice.kind))
    .sort((a, b) => b.sequence - a.sequence)[0];
  if (terminal) return terminal.kind as SubAgentRunStatus;
  const queued = notices.some(
    (notice) => notice.kind === "queued" && notice.runId === dispatch.runId,
  );
  return queued ? "queued" : "running";
}

/**
 * Walks the chain in order and, before each tool call with a sequence, emits the pending
 * events with a lower sequence; the remaining events follow the last chain item.
 */
export function interleaveWorkflowEvents(
  chain: readonly ChainItem[],
  events: readonly ParentTimelineEvent[],
): WorkflowEntry[] {
  const pending = [...events].sort((a, b) => a.sequence - b.sequence);
  const entries: WorkflowEntry[] = [];
  for (const item of chain) {
    const sequence = item.kind === "tool-call" ? item.timelineSequence : undefined;
    if (isTimelineSequence(sequence)) {
      while (pending.length > 0 && pending[0]!.sequence < sequence) {
        entries.push({ type: "event", event: pending.shift()! });
      }
    }
    entries.push({ type: "item", item });
  }
  for (const event of pending) entries.push({ type: "event", event });
  return entries;
}

function agentTitle(sessionId: string, notices: readonly SubAgentNoticeEntry[]): string {
  const own = notices.filter((notice) => notice.sessionId === sessionId && notice.description);
  const created = own.find((notice) => notice.kind === "created" || notice.kind === "queued");
  return (created ?? own[0])?.description ?? "";
}
