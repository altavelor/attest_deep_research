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
      outcome?: SubAgentNoticeEntry;
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
 * ascending sequence, keeping the first entry of a repeated event key. A run's outcome and
 * queued notices are shown inside its dispatch card, so they are not placed on their own.
 * Events of a Deep Research turn are left out, since its research card shows the branches.
 * Events whose run has no rendered message stay orphans, shown by the transcript on their own.
 */
export function placeSubAgentEvents(
  messages: readonly ChatDisplayMessage[],
  dispatches: readonly SubAgentDispatchEntry[],
  notices: readonly SubAgentNoticeEntry[],
): SubAgentEventPlacement {
  const ids = new Set(messages.map((message) => message.id).filter(Boolean));
  const research = new Set(
    messages.filter((message) => message.research).map((message) => message.id),
  );
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
    if (research.has(id)) return true;
    const events = byMessageId.get(id);
    if (events) events.push(event);
    else byMessageId.set(id, [event]);
    return true;
  };
  const uniqueNotices = notices.filter(fresh);
  const index = indexNotices(uniqueNotices);
  const folded = new Map<string, number>();
  for (const dispatch of dispatches.filter(fresh)) {
    const event = decorate(dispatch, index);
    for (const notice of foldedNotices(event, index)) folded.set(notice.eventKey, notice.sequence);
    if (!place(dispatch.parentRunId, event)) placement.orphanDispatches.push(dispatch);
  }
  for (const notice of uniqueNotices) {
    if (folded.has(notice.eventKey)) continue;
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
): { status: SubAgentRunStatus; durationMs?: number; outcome?: SubAgentNoticeEntry } {
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
      ? { status, outcome: terminal }
      : { status, durationMs: terminal.durationMs, outcome: terminal };
  }
  return { status: queued ? "queued" : "running" };
}

/** Returns the notices a dispatch card shows itself: its run's outcome and queued notices. */
function foldedNotices(
  event: Extract<ParentTimelineEvent, { kind: "agent-dispatch" }>,
  index: NoticeIndex,
): SubAgentNoticeEntry[] {
  const queued = (index.byRun.get(event.dispatch.runId) ?? []).filter(
    (notice) => notice.kind === "queued",
  );
  return event.outcome ? [event.outcome, ...queued] : queued;
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
 * initial dispatch at the earlier sequence, and drops a closed notice when every dispatched
 * run, and every session without a dispatch, already reported a settled outcome before it.
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
  const settledBy = settledSequences(events);
  return arranged
    .filter(
      (event) =>
        !(event.kind === "agent-notice" && merged.has(event.notice.eventKey)) &&
        !(
          event.kind === "agent-notice" &&
          event.notice.kind === "closed" &&
          settledBy !== null &&
          settledBy < event.sequence
        ),
    )
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * Returns the sequence by which every dispatched run and every session of one parent run
 * has its first settled notice, or null when some never settles or none
 * exists. Interrupted notices do not settle, since a close may cause them.
 */
function settledSequences(events: readonly ParentTimelineEvent[]): number | null {
  const runs = new Set<string>();
  const sessions = new Set<string>();
  const firstByRun = new Map<string, number>();
  const firstBySession = new Map<string, number>();
  const first = (map: Map<string, number>, key: string, sequence: number) => {
    map.set(key, Math.min(map.get(key) ?? sequence, sequence));
  };
  const settle = (notice: SubAgentNoticeEntry): void => {
    if (!SETTLED_KINDS.has(notice.kind)) return;
    if (notice.runId !== null) first(firstByRun, notice.runId, notice.sequence);
    if (notice.sessionId !== null) first(firstBySession, notice.sessionId, notice.sequence);
  };
  for (const event of events) {
    if (event.kind === "agent-dispatch") {
      runs.add(event.dispatch.runId);
      if (event.outcome) settle(event.outcome);
      continue;
    }
    if (event.notice.sessionId !== null) sessions.add(event.notice.sessionId);
    settle(event.notice);
  }
  const units = [
    ...[...runs].map((runId) => firstByRun.get(runId)),
    ...[...sessions].map((sessionId) => firstBySession.get(sessionId)),
  ];
  if (units.length === 0 || units.some((sequence) => sequence === undefined)) return null;
  return (units as number[]).reduce((max, sequence) => Math.max(max, sequence), -Infinity);
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
