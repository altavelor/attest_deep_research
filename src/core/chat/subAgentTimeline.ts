import type { ChatDisplayMessage } from "@core/conversation/model";
import {
  capRedactedText,
  MAX_REPLY_EXCERPT_BYTES,
  MAX_SUB_AGENT_TASK_CHARS,
  type NormalizedUsage,
  type SubAgentDispatchEntry,
  type SubAgentNoticeEntry,
  type SubAgentNoticeKind,
} from "@core/research/subAgent";

export type ChatTimelineItem =
  | { kind: "message"; sequence: number; message: ChatDisplayMessage }
  | { kind: "agent-dispatch"; sequence: number; dispatch: SubAgentDispatchEntry }
  | { kind: "agent-notice"; sequence: number; notice: SubAgentNoticeEntry };

export interface SubAgentTimelineState {
  messages: ChatDisplayMessage[];
  subAgentDispatches: readonly SubAgentDispatchEntry[];
  subAgentNotices: readonly SubAgentNoticeEntry[];
  timelineSequence: number;
}

const MAX_EVENT_KEY_CHARS = 1024;
const MAX_ID_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_TIMELINE_EVENTS = 2000;
const SAFE_ID = /^[A-Za-z0-9:_.-]+$/u;
const COMMAND_KINDS = new Set(["initial", "follow-up", "continue-partial", "retry"]);
const NOTICE_KINDS = new Set<SubAgentNoticeKind>([
  "created",
  "queued",
  "not-started",
  "finished",
  "partial",
  "failed",
  "stopped",
  "interrupted",
  "import-failed",
  "closed",
  "batch",
]);
const USAGE_COUNTS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reasoningTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
] as const;

/**
 * Reads untrusted saved dispatch entries: malformed entries are dropped, a repeated
 * event key keeps its first entry and the command body never exceeds the task limit.
 */
export function parseSubAgentDispatches(value: unknown): SubAgentDispatchEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: SubAgentDispatchEntry[] = [];
  for (const candidate of value.slice(0, MAX_TIMELINE_EVENTS)) {
    const entry = readDispatch(candidate);
    if (!entry || seen.has(entry.eventKey)) continue;
    seen.add(entry.eventKey);
    entries.push(entry);
  }
  return entries;
}

/**
 * Reads untrusted saved notices: malformed entries are dropped, a repeated event key
 * keeps its first entry and a reply excerpt is cut to the excerpt byte limit.
 */
export function parseSubAgentNotices(value: unknown): SubAgentNoticeEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: SubAgentNoticeEntry[] = [];
  for (const candidate of value.slice(0, MAX_TIMELINE_EVENTS)) {
    const entry = readNotice(candidate);
    if (!entry || seen.has(entry.eventKey)) continue;
    seen.add(entry.eventKey);
    entries.push(entry);
  }
  return entries;
}

/** Returns a saved allocator value when it is a nonnegative safe integer, otherwise zero. */
export function parseTimelineSequence(value: unknown): number {
  return isSequence(value) ? value : 0;
}

/**
 * Gives every timeline item a unique sequence without reordering messages. Messages
 * keep a valid increasing sequence and receive the next free one otherwise; events
 * that collide are moved after the highest sequence in event-key order, and the
 * allocator ends above every sequence in use.
 */
export function normalizeSubAgentTimeline(state: SubAgentTimelineState): SubAgentTimelineState {
  const events = [
    ...state.subAgentDispatches.map((entry) => ({ key: entry.eventKey, sequence: entry.sequence })),
    ...state.subAgentNotices.map((entry) => ({ key: entry.eventKey, sequence: entry.sequence })),
  ];
  const used = new Set<number>();
  let next = Math.max(1, state.timelineSequence, ...events.map((event) => event.sequence + 1));
  let previous = 0;
  const messages = state.messages.map((message) => {
    if (message.kind === "compact-summary") return withoutSequence(message);
    const current = message.timelineSequence;
    if (isSequence(current) && current > previous && !used.has(current)) {
      used.add(current);
      previous = current;
      next = Math.max(next, current + 1);
      return message;
    }
    const sequence = Math.max(next, previous + 1);
    used.add(sequence);
    previous = sequence;
    next = sequence + 1;
    return { ...message, timelineSequence: sequence };
  });
  const moved = new Map<string, number>();
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence || left.key.localeCompare(right.key),
  );
  for (const event of ordered) {
    if (used.has(event.sequence)) {
      moved.set(event.key, next);
      used.add(next);
      next += 1;
    } else {
      used.add(event.sequence);
    }
  }
  const resequence = <T extends { eventKey: string; sequence: number }>(entry: T): T => {
    const sequence = moved.get(entry.eventKey);
    return sequence === undefined ? entry : { ...entry, sequence };
  };
  return {
    messages,
    subAgentDispatches: state.subAgentDispatches.map(resequence),
    subAgentNotices: state.subAgentNotices.map(resequence),
    timelineSequence: next,
  };
}

export type SubAgentTimelineEvent =
  | { type: "dispatch"; entry: Omit<SubAgentDispatchEntry, "sequence"> }
  | { type: "notice"; entry: Omit<SubAgentNoticeEntry, "sequence"> };

/**
 * Adds one main-visible event with the next shared sequence, after first stamping
 * messages that have none. A known event key changes nothing, except a batch notice,
 * which is updated in place with its original sequence; null means unchanged.
 */
export function applySubAgentTimelineEvent(
  state: SubAgentTimelineState,
  event: SubAgentTimelineEvent,
): SubAgentTimelineState | null {
  const key = event.entry.eventKey;
  if (event.type === "dispatch") {
    if (state.subAgentDispatches.some((entry) => entry.eventKey === key)) return null;
    const stamped = normalizeSubAgentTimeline(state);
    return {
      ...stamped,
      subAgentDispatches: [
        ...stamped.subAgentDispatches,
        { ...event.entry, sequence: stamped.timelineSequence },
      ],
      timelineSequence: stamped.timelineSequence + 1,
    };
  }
  const existing = state.subAgentNotices.findIndex((entry) => entry.eventKey === key);
  if (existing !== -1) {
    if (event.entry.kind !== "batch") return null;
    const notices = [...state.subAgentNotices];
    notices[existing] = { ...event.entry, sequence: notices[existing]!.sequence };
    return { ...state, subAgentNotices: notices };
  }
  const stamped = normalizeSubAgentTimeline(state);
  return {
    ...stamped,
    subAgentNotices: [
      ...stamped.subAgentNotices,
      { ...event.entry, sequence: stamped.timelineSequence },
    ],
    timelineSequence: stamped.timelineSequence + 1,
  };
}

/** Builds the single parent order of messages, dispatches and notices by sequence. */
export function buildChatTimeline(
  state: Omit<SubAgentTimelineState, "timelineSequence">,
): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [
    ...state.messages.map((message, index) => ({
      kind: "message" as const,
      sequence: messageSortKey(state.messages, index),
      message,
    })),
    ...state.subAgentDispatches.map((dispatch) => ({
      kind: "agent-dispatch" as const,
      sequence: dispatch.sequence,
      dispatch,
    })),
    ...state.subAgentNotices.map((notice) => ({
      kind: "agent-notice" as const,
      sequence: notice.sequence,
      notice,
    })),
  ];
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.sequence - right.item.sequence || left.index - right.index)
    .map(({ item }) => item);
}

/**
 * A message without its own sequence, such as a compaction marker, sorts just before
 * the next sequenced message, or just after the previous one at the end of the chat.
 */
function messageSortKey(messages: readonly ChatDisplayMessage[], index: number): number {
  const own = messages[index]!.timelineSequence;
  if (own !== undefined) return own;
  const following = messages
    .slice(index + 1)
    .find((message) => message.timelineSequence !== undefined);
  if (following) return following.timelineSequence! - 0.5;
  const preceding = messages
    .slice(0, index)
    .reverse()
    .find((message) => message.timelineSequence !== undefined);
  return (preceding?.timelineSequence ?? index) + 0.5;
}

function withoutSequence(message: ChatDisplayMessage): ChatDisplayMessage {
  if (message.timelineSequence === undefined) return message;
  const { timelineSequence: _timelineSequence, ...rest } = message;
  return rest;
}

function readDispatch(value: unknown): SubAgentDispatchEntry | null {
  if (!isRecord(value)) return null;
  if (
    !isEventKey(value.eventKey, "dispatch:") ||
    !isId(value.sessionId) ||
    !isId(value.runId) ||
    !isId(value.parentRunId) ||
    typeof value.body !== "string" ||
    value.body.length > MAX_SUB_AGENT_TASK_CHARS ||
    typeof value.createdAt !== "string" ||
    !COMMAND_KINDS.has(value.commandKind as string) ||
    !isSequence(value.attempt) ||
    !isSequence(value.sequence)
  ) {
    return null;
  }
  return {
    eventKey: value.eventKey as string,
    sessionId: value.sessionId as string,
    runId: value.runId as string,
    parentRunId: value.parentRunId as string,
    body: value.body,
    createdAt: value.createdAt,
    commandKind: value.commandKind as SubAgentDispatchEntry["commandKind"],
    attempt: value.attempt as number,
    sequence: value.sequence as number,
  };
}

function readNotice(value: unknown): SubAgentNoticeEntry | null {
  if (!isRecord(value)) return null;
  if (
    !isEventKey(value.eventKey, "notice:") ||
    !isId(value.parentRunId) ||
    typeof value.description !== "string" ||
    typeof value.createdAt !== "string" ||
    !(value.sessionId === null || isId(value.sessionId)) ||
    !(value.runId === null || isId(value.runId)) ||
    !NOTICE_KINDS.has(value.kind as SubAgentNoticeKind) ||
    !isSequence(value.sequence)
  ) {
    return null;
  }
  const reply =
    typeof value.replyExcerpt === "string"
      ? capRedactedText(value.replyExcerpt, MAX_REPLY_EXCERPT_BYTES, "utf8")
      : null;
  const usage = readUsage(value.usage);
  return {
    eventKey: value.eventKey as string,
    parentRunId: value.parentRunId as string,
    description: value.description.slice(0, MAX_DESCRIPTION_CHARS),
    createdAt: value.createdAt,
    sessionId: value.sessionId as string | null,
    runId: value.runId as string | null,
    sequence: value.sequence as number,
    kind: value.kind as SubAgentNoticeKind,
    ...(isId(value.batchId) ? { batchId: value.batchId as string } : {}),
    ...(isCount(value.durationMs) ? { durationMs: value.durationMs } : {}),
    ...(usage ? { usage } : {}),
    ...(typeof value.modelLabel === "string" && value.modelLabel.length <= MAX_ID_CHARS
      ? { modelLabel: value.modelLabel }
      : {}),
    ...(typeof value.reasonCode === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value.reasonCode)
      ? { reasonCode: value.reasonCode }
      : {}),
    ...(reply
      ? {
          replyExcerpt: reply.text,
          replyTruncated: reply.truncated || value.replyTruncated === true,
        }
      : {}),
    ...(readBatch(value.batch) ? { batch: readBatch(value.batch)! } : {}),
    ...(isSequence(value.closedCount) ? { closedCount: value.closedCount } : {}),
  };
}

function readUsage(value: unknown): NormalizedUsage | null {
  if (!isRecord(value)) return null;
  const counts = ["requestCount", "modelRounds", "toolCalls", "durationMs"] as const;
  if (!counts.every((key) => isCount(value[key]))) return null;
  if (
    value.source !== "provider" &&
    value.source !== "estimated" &&
    value.source !== "unavailable"
  ) {
    return null;
  }
  const usage: NormalizedUsage = {
    requestCount: value.requestCount as number,
    modelRounds: value.modelRounds as number,
    toolCalls: value.toolCalls as number,
    durationMs: value.durationMs as number,
    source: value.source,
  };
  for (const key of USAGE_COUNTS) {
    if (isCount(value[key])) usage[key] = value[key] as number;
  }
  return usage;
}

function readBatch(value: unknown): SubAgentNoticeEntry["batch"] | null {
  if (!isRecord(value)) return null;
  const keys = ["total", "done", "running", "failed"] as const;
  if (!keys.every((key) => isSequence(value[key]))) return null;
  return {
    total: value.total as number,
    done: value.done as number,
    running: value.running as number,
    failed: value.failed as number,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEventKey(value: unknown, prefix: string): boolean {
  return (
    typeof value === "string" && value.startsWith(prefix) && value.length <= MAX_EVENT_KEY_CHARS
  );
}

function isId(value: unknown): boolean {
  return typeof value === "string" && value.length <= MAX_ID_CHARS && SAFE_ID.test(value);
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
