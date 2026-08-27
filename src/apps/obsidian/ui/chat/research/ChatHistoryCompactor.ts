import {
  compactableMessages,
  compactChatMessages,
  compactionSummaryFromMessages,
  shouldCompactForContext,
} from "@application/use-cases/chat";
import { ResearchService } from "@application/use-cases/research";
import { toUserMessage } from "@core/errors";
import { ChatDisplayMessage } from "@core/conversation";
import type { Translate } from "@adapters/i18n";
import { Notice } from "obsidian";

export interface ChatHistoryCompactorOptions {
  getMessages(sessionId: string): ChatDisplayMessage[];
  setMessages(sessionId: string, messages: ChatDisplayMessage[]): void;
  getContextLimitTokens(sessionId: string): number | undefined;
  getReservedOutputTokens(sessionId: string): number | undefined;
  createResearchService(sessionId: string): ResearchService;
  saveCurrentChat(sessionId: string): Promise<void>;
  isSessionDisplayed(sessionId: string): boolean;
  setProgressStatus(message: string | null): void;
  renderMessages(): void;
  t: Translate;
}

/**
 * Coordinates context-driven chat-history compaction and its user-visible
 * status. Every step is bound to the session that started it, so switching
 * chats mid-compaction cannot rewrite the newly selected chat.
 */
export class ChatHistoryCompactor {
  constructor(private readonly options: ChatHistoryCompactorOptions) {}

  async compactIfNeeded(sessionId: string, question: string): Promise<boolean> {
    if (
      !shouldCompactForContext({
        question,
        messages: this.options.getMessages(sessionId),
        contextLimitTokens: this.options.getContextLimitTokens(sessionId),
        reservedOutputTokens: this.options.getReservedOutputTokens(sessionId),
      })
    ) {
      return false;
    }

    return this.compactHistory(sessionId, { automatic: true });
  }

  async compactHistory(sessionId: string, options: { automatic: boolean }): Promise<boolean> {
    const messages = this.options.getMessages(sessionId);
    const compactable = compactableMessages(messages);

    if (compactable.length === 0) {
      const message = this.options.t("chat.compact.nothingToCompact");
      this.report(sessionId, message);
      return false;
    }

    const status = options.automatic
      ? this.options.t("chat.compact.automaticStatus")
      : this.options.t("chat.compact.manualStatus");
    this.setProgressStatus(sessionId, status);
    if (options.automatic) {
      this.options.setMessages(sessionId, [
        ...messages,
        {
          role: "assistant",
          content: this.options.t("chat.compact.automaticMessage"),
          createdAt: new Date().toISOString(),
        },
      ]);
      this.renderMessages(sessionId);
      await this.options.saveCurrentChat(sessionId);
    }

    try {
      const sourceMessages = options.automatic
        ? compactableMessages(this.options.getMessages(sessionId))
        : compactable;
      const summary = await this.options
        .createResearchService(sessionId)
        .summarizeChatHistoryForCompaction(
          sourceMessages,
          compactionSummaryFromMessages(this.options.getMessages(sessionId)),
        );
      const result = compactChatMessages(this.options.getMessages(sessionId), { summary });

      if (!result.changed) {
        return false;
      }

      this.options.setMessages(sessionId, result.messages);
      await this.options.saveCurrentChat(sessionId);
      this.renderMessages(sessionId);
      this.report(sessionId, this.options.t("chat.compact.done", { count: result.compactedCount }));
      return true;
    } catch (error) {
      this.report(sessionId, toUserMessage(error));
      return false;
    }
  }

  private report(sessionId: string, message: string): void {
    this.setProgressStatus(sessionId, message);
    new Notice(message);
  }

  private setProgressStatus(sessionId: string, message: string | null): void {
    if (!this.options.isSessionDisplayed(sessionId)) return;
    this.options.setProgressStatus(message);
  }

  private renderMessages(sessionId: string): void {
    if (!this.options.isSessionDisplayed(sessionId)) return;
    this.options.renderMessages();
  }
}
