export type ChatSessionStatus =
  "idle" | "queued" | "running" | "stopping" | "completed" | "failed" | "interrupted";

export type InterruptionReason = "user" | "plugin-unload" | "crash-recovery";

export const MAX_CONCURRENT_CHAT_SESSIONS = 6;

export interface SavedChatRunStateBase {
  runId: string;
  startedAt: string;
  completedAt?: string;
}

export type SavedChatRunState =
  | (SavedChatRunStateBase & {
      status: "queued" | "running" | "stopping" | "completed" | "failed";
    })
  | (SavedChatRunStateBase & {
      status: "interrupted";
      interruptionReason: InterruptionReason;
    });

export interface ChatHistoryActivity {
  runningCount: number;
  unreadCompletedCount: number;
}

export interface ChatActivityEntry {
  status: ChatSessionStatus;
  unreadCompletion: boolean;
}

export function isChatSessionStatus(value: unknown): value is ChatSessionStatus {
  return (
    value === "idle" ||
    value === "queued" ||
    value === "running" ||
    value === "stopping" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted"
  );
}

export function isInterruptionReason(value: unknown): value is InterruptionReason {
  return value === "user" || value === "plugin-unload" || value === "crash-recovery";
}

/** Queued, running, and stopping chats keep their runtime slot and deletion guard. */
export function isNonTerminalChatSessionStatus(status: ChatSessionStatus): boolean {
  return status === "queued" || status === "running" || status === "stopping";
}

export function isTerminalChatSessionStatus(status: ChatSessionStatus): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}

/**
 * Picks the status a newly persisted run may take under the six-slot policy.
 * The argument is the number of sessions already holding an execution slot.
 */
export function nextRunStatus(occupiedSlots: number): "running" | "queued" {
  return occupiedSlots < MAX_CONCURRENT_CHAT_SESSIONS ? "running" : "queued";
}

/**
 * Aggregates chat-list state for the Chats history button. Only `running`
 * sessions count as active; queued and stopping ones do not.
 */
export function chatHistoryActivity(entries: readonly ChatActivityEntry[]): ChatHistoryActivity {
  let runningCount = 0;
  let unreadCompletedCount = 0;
  for (const entry of entries) {
    if (entry.status === "running") runningCount += 1;
    if (entry.unreadCompletion) unreadCompletedCount += 1;
  }
  return { runningCount, unreadCompletedCount };
}

/**
 * Converts a persisted run left non-terminal by an abnormal shutdown into an
 * interrupted run. Terminal runs and absent metadata are returned unchanged.
 */
export function normalizeStaleRunState(
  run: SavedChatRunState | undefined,
  completedAt: string,
): SavedChatRunState | undefined {
  if (!run || !isNonTerminalChatSessionStatus(run.status)) return run;
  return {
    runId: run.runId,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? completedAt,
    status: "interrupted",
    interruptionReason: "crash-recovery",
  };
}

/** Discards malformed persisted run metadata without dropping the chat itself. */
export function parseSavedChatRunState(value: unknown): SavedChatRunState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const run = value as Record<string, unknown>;
  if (typeof run.runId !== "string" || run.runId.length === 0) return undefined;
  if (typeof run.startedAt !== "string" || run.startedAt.length === 0) return undefined;
  if (run.completedAt !== undefined && typeof run.completedAt !== "string") return undefined;
  if (!isChatSessionStatus(run.status) || run.status === "idle") return undefined;

  const base: SavedChatRunStateBase = {
    runId: run.runId,
    startedAt: run.startedAt,
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
  };

  if (run.status === "interrupted") {
    return isInterruptionReason(run.interruptionReason)
      ? { ...base, status: "interrupted", interruptionReason: run.interruptionReason }
      : undefined;
  }

  return { ...base, status: run.status };
}
