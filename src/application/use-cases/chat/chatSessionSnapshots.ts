import { createConversationSourceRegistry } from "@core/chat/sourceRegistry";
import type { SavedChat, SavedChatSettings } from "@core/chat/savedChat";
import { normalizeSubAgentTimeline } from "@core/chat/subAgentTimeline";
import { parseSubAgentDirective } from "@core/research";
import type { ResearchMode } from "@core/research";
import type { ChatSessionState } from "./chatSessionTypes";

export function createIdleSessionState(
  sessionId: string,
  chatSettings: SavedChatSettings,
): ChatSessionState {
  return {
    sessionId,
    chatId: null,
    status: "idle",
    activeRunId: null,
    messages: [],
    lastAnswer: null,
    sourceRegistry: createConversationSourceRegistry(),
    attachedContextPaths: [],
    chatSettings,
    draft: "",
    progressLabel: null,
    startedAt: null,
    completedAt: null,
    unreadCompletion: false,
    interruptionReason: null,
    subAgentDispatches: [],
    subAgentNotices: [],
    timelineSequence: 0,
    recoveredFromPrevious: false,
  };
}

/** Builds the runtime session that represents an already persisted chat. */
export function sessionStateFromSavedChat(
  sessionId: string,
  chat: SavedChat,
  chatSettings: SavedChatSettings,
): ChatSessionState {
  const lastRun = chat.lastRun;
  const timeline = normalizeSubAgentTimeline({
    messages: chat.messages,
    subAgentDispatches: chat.subAgentDispatches ?? [],
    subAgentNotices: chat.subAgentNotices ?? [],
    timelineSequence: chat.timelineSequence ?? 0,
  });
  return {
    ...createIdleSessionState(sessionId, chatSettings),
    chatId: chat.id,
    status: terminalStatusOf(chat),
    messages: timeline.messages,
    subAgentDispatches: timeline.subAgentDispatches,
    subAgentNotices: timeline.subAgentNotices,
    timelineSequence: timeline.timelineSequence,
    lastAnswer: chat.lastAnswer,
    sourceRegistry: chat.sourceRegistry,
    attachedContextPaths: [...chat.attachedContextPaths],
    startedAt: lastRun?.startedAt ?? null,
    completedAt: lastRun?.completedAt ?? null,
    unreadCompletion: chat.unreadCompletion,
    interruptionReason: lastRun?.status === "interrupted" ? lastRun.interruptionReason : null,
    recoveredFromPrevious: chat.recoveredFrom === "previous",
    ...(chat.deepResearch ? { deepResearch: chat.deepResearch } : {}),
  };
}

/**
 * A persisted chat is never adopted as a live run: startup recovery has already
 * normalized stale non-terminal runs, so anything still non-terminal here is
 * shown as interrupted rather than as a run nobody drives.
 */
function terminalStatusOf(chat: SavedChat): ChatSessionState["status"] {
  const status = chat.lastRun?.status;
  if (status === undefined) return "idle";
  if (status === "completed" || status === "failed" || status === "interrupted") return status;
  return "interrupted";
}

/** The `/sub-agent` directive forces thinking mode regardless of chat settings. */
export function resolveRunMode(question: string, settings: SavedChatSettings): ResearchMode {
  return parseSubAgentDirective(question).forceSubAgent
    ? "thinking"
    : (settings.researchMode ?? "instant");
}
