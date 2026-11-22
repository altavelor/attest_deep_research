import { isChatStorageError, type ChatRepository } from "@application/ports/chat";
import { isNonTerminalChatSessionStatus, normalizeStaleRunState } from "@core/chat/chatSession";
import { removeOrphanSubAgentAliases } from "@core/chat/subAgentAliases";
import { withCrashRecoveryNotices } from "@core/chat/subAgentRecoveryNotices";
import { interruptLastAssistantProgress } from "@core/conversation";
import { recoverSubAgentState } from "@core/research";

const SKIPPED_RECOVERY_CODES = new Set([
  "unreadable-section",
  "invalid-snapshot",
  "chat-missing",
  "document-conflict",
]);

/**
 * Startup recovery. Converts persisted queued, running, or stopping runs into
 * interrupted ones with reason `crash-recovery`, preserving `updatedAt` so an
 * old chat does not jump to the top of history. The chat, its recovered sub-agent
 * section and their interrupted notices are written in one commit; a chat changed
 * meanwhile is skipped.
 */
export async function normalizeStaleChats(repository: ChatRepository, now: Date): Promise<void> {
  const summaries = await repository.listChats();
  const completedAt = now.toISOString();
  for (const summary of summaries) {
    if (!summary.lastRun || !isNonTerminalChatSessionStatus(summary.lastRun.status)) continue;
    const document = await repository.loadChatDocument(summary.id);
    if (!document?.chat.lastRun || document.chat.recoveredFrom) continue;
    const { chat } = document;
    const lastRun = normalizeStaleRunState(chat.lastRun, completedAt);
    if (!lastRun) continue;
    const section = chat.subAgents?.status === "ready" ? chat.subAgents.snapshot : null;
    const subAgents = section ? recoverSubAgentState(section, completedAt) : null;
    const timeline = {
      messages: interruptLastAssistantProgress(chat.messages),
      subAgentDispatches: chat.subAgentDispatches ?? [],
      subAgentNotices: chat.subAgentNotices ?? [],
      timelineSequence: chat.timelineSequence ?? 0,
    };
    const recovered =
      section && subAgents
        ? withCrashRecoveryNotices(timeline, chat.id, section, subAgents, completedAt)
        : timeline;
    try {
      await repository.commitChatDocument({
        chatId: chat.id,
        base: document.base,
        chat: {
          id: chat.id,
          title: chat.title,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          messages: recovered.messages,
          lastAnswer: chat.lastAnswer,
          attachedContextPaths: chat.attachedContextPaths,
          chatSettings: chat.chatSettings,
          sourceRegistry: subAgents
            ? removeOrphanSubAgentAliases(chat.sourceRegistry, subAgents)
            : chat.sourceRegistry,
          unreadCompletion: chat.unreadCompletion,
          lastRun,
          ...(recovered !== timeline
            ? {
                subAgentDispatches: [...recovered.subAgentDispatches],
                subAgentNotices: [...recovered.subAgentNotices],
                timelineSequence: recovered.timelineSequence,
              }
            : {}),
        },
        ...(subAgents && subAgents !== section ? { subAgents } : {}),
      });
    } catch (error) {
      if (!isChatStorageError(error) || !SKIPPED_RECOVERY_CODES.has(error.code)) throw error;
    }
  }
}
