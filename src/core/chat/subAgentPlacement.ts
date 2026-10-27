import { answerMessageId } from "@core/conversation/messageIds";
import type { ChainItem, ChatDisplayMessage } from "@core/conversation/model";
import { isHiddenSubAgentRow } from "@core/conversation/parentProjection";
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
      durationMs?: number;
      created?: SubAgentNoticeEntry;
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

const SETTLED_KINDS = new Set<SubAgentNoticeKind>(
  [...TERMINAL_KINDS].filter((kind) => kind !== "interrupted"),
);

/**
 * Assigns each dispatch and notice to the assistant message of its parent run, in
 * ascending sequence, keeping the first entry of a repeated event key. Events whose run
 * has no rendered message stay orphans, so the transcript can still show them on their own.
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
  const seen = new Set<string>();
  const fresh = <T extends { eventKey: string }>(entry: T): boolean =>
    !seen.has(entry.eventKey) && Boolean(seen.add(entry.eventKey));
  const place = (parentRunId: string, event: ParentTimelineEvent): boolean => {
    const id = answerMessageId(parentRunId);
    if (!ids.has(id)) return false;
    const events = byMessageId.get(id);
    if (events) events.push(event);
    else byMessageId.set(id, [event]);
    return true;
  };
  const uniqueNotices = notices.filter(fresh);
  const index = indexNotices(uniqueNotices);
  for (const dispatch of dispatches.filter(fresh)) {
    if (!place(dispatch.parentRunId, decorate(dispatch, index))) {
      placement.orphanDispatches.push(dispatch);
    }
  }
  for (const notice of uniqueNotices) {
    const event = { kind: "agent-notice" as const, sequence: notice.sequence, notice };
    if (!place(notice.parentRunId, event)) placement.orphanNotices.push(notice);
  }
  for (const [id, events] of byMessageId) byMessageId.set(id, arrangeRunEvents(events));
  return placement;
}

/** Decorates a dispatch with the agent title and the live status derived from the notices. */
export function dispatchEvent(
  dispatch: SubAgentDispatchEntry,
  notices: readonly SubAgentNoticeEntry[],
): Extract<ParentTimelineEvent, { kind: "agent-dispatch" }> {
  return decorate(dispatch, indexNotices(notices));
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
  return runOutcome(dispatch, notices).status;
}

function runOutcome(
  dispatch: Pick<SubAgentDispatchEntry, "runId">,
  notices: readonly SubAgentNoticeEntry[],
): { status: SubAgentRunStatus; durationMs?: number } {
  let terminal: SubAgentNoticeEntry | undefined;
  let queued = false;
  for (const notice of notices) {
    if (notice.runId !== dispatch.runId) continue;
    if (notice.kind === "queued") queued = true;
    else if (TERMINAL_KINDS.has(notice.kind) && notice.sequence > (terminal?.sequence ?? -1)) {
      terminal = notice;
    }
  }
  if (terminal) {
    const status = terminal.kind as SubAgentRunStatus;
    return terminal.durationMs === undefined
      ? { status }
      : { status, durationMs: terminal.durationMs };
  }
  return { status: queued ? "queued" : "running" };
}

interface NoticeIndex {
  byRun: Map<string, SubAgentNoticeEntry[]>;
  bySession: Map<string, SubAgentNoticeEntry[]>;
}

function indexNotices(notices: readonly SubAgentNoticeEntry[]): NoticeIndex {
  const index: NoticeIndex = { byRun: new Map(), bySession: new Map() };
  const add = (
    map: Map<string, SubAgentNoticeEntry[]>,
    key: string | null,
    notice: SubAgentNoticeEntry,
  ) => {
    if (key === null) return;
    const list = map.get(key);
    if (list) list.push(notice);
    else map.set(key, [notice]);
  };
  for (const notice of notices) {
    add(index.byRun, notice.runId, notice);
    add(index.bySession, notice.sessionId, notice);
  }
  return index;
}

function decorate(
  dispatch: SubAgentDispatchEntry,
  index: NoticeIndex,
): Extract<ParentTimelineEvent, { kind: "agent-dispatch" }> {
  return {
    kind: "agent-dispatch",
    sequence: dispatch.sequence,
    dispatch,
    title: agentTitle(index.bySession.get(dispatch.sessionId) ?? []),
    ...runOutcome(dispatch, index.byRun.get(dispatch.runId) ?? []),
  };
}

/**
 * Orders the events of one parent run, folds each session's created notice into its
 * initial dispatch at the earlier sequence, and drops a closed notice that only closes
 * sessions which already reported their own outcome before it.
 */
function arrangeRunEvents(events: readonly ParentTimelineEvent[]): ParentTimelineEvent[] {
  const created = new Map<string, Extract<ParentTimelineEvent, { kind: "agent-notice" }>>();
  for (const event of events) {
    const sessionId = event.kind === "agent-notice" ? event.notice.sessionId : null;
    if (event.kind === "agent-notice" && event.notice.kind === "created" && sessionId !== null) {
      if (!created.has(sessionId)) created.set(sessionId, event);
    }
  }
  const merged = new Set<string>();
  const arranged = events.map((event): ParentTimelineEvent => {
    if (event.kind !== "agent-dispatch" || event.dispatch.commandKind !== "initial") return event;
    const notice = created.get(event.dispatch.sessionId);
    if (!notice || merged.has(notice.notice.eventKey)) return event;
    merged.add(notice.notice.eventKey);
    return {
      ...event,
      created: notice.notice,
      sequence: Math.min(notice.sequence, event.sequence),
    };
  });
  return arranged
    .filter(
      (event) =>
        !(event.kind === "agent-notice" && merged.has(event.notice.eventKey)) &&
        !isRedundantClose(event, events),
    )
    .sort((a, b) => a.sequence - b.sequence);
}

function isRedundantClose(event: ParentTimelineEvent, events: readonly ParentTimelineEvent[]) {
  if (event.kind !== "agent-notice" || event.notice.kind !== "closed") return false;
  const sessions = new Set<string>();
  const settled = new Set<string>();
  for (const other of events) {
    const sessionId =
      other.kind === "agent-dispatch" ? other.dispatch.sessionId : other.notice.sessionId;
    if (sessionId === null) continue;
    sessions.add(sessionId);
    if (
      other.kind === "agent-notice" &&
      other.sequence < event.sequence &&
      SETTLED_KINDS.has(other.notice.kind)
    ) {
      settled.add(sessionId);
    }
  }
  return sessions.size > 0 && settled.size === sessions.size;
}

/**
 * Walks the chain in order and, before each item with a sequence, emits the pending events
 * with a lower sequence; the remaining events follow the last chain item. Hidden sub-agent
 * rows still anchor events by their sequence but are not emitted themselves.
 */
export function interleaveWorkflowEvents(
  chain: readonly ChainItem[],
  events: readonly ParentTimelineEvent[],
): WorkflowEntry[] {
  const pending = [...events].sort((a, b) => a.sequence - b.sequence);
  const entries: WorkflowEntry[] = [];
  for (const item of chain) {
    const sequence = item.timelineSequence;
    if (isTimelineSequence(sequence)) {
      while (pending.length > 0 && pending[0]!.sequence < sequence) {
        entries.push({ type: "event", event: pending.shift()! });
      }
    }
    if (!isHiddenSubAgentRow(item)) entries.push({ type: "item", item });
  }
  for (const event of pending) entries.push({ type: "event", event });
  return entries;
}

function agentTitle(notices: readonly SubAgentNoticeEntry[]): string {
  const own = notices.filter((notice) => notice.description);
  const created = own.find((notice) => notice.kind === "created" || notice.kind === "queued");
  return (created ?? own[0])?.description ?? "";
}
