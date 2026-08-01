import {
  compactableMessages,
  compactChatMessages,
  compactionSummaryFromMessages,
  shouldCompactForContext,
} from "@application/use-cases/chat";
import { ResearchService } from "@application/use-cases/research";
import { toUserMessage } from "@core/errors";
import { ChatDisplayMessage } from "@core/conversation";
import { Notice } from "obsidian";

export interface ChatHistoryCompactorOptions {
  getMessages(): ChatDisplayMessage[];
  setMessages(messages: ChatDisplayMessage[]): void;
  getContextLimitTokens(): number | undefined;
  getReservedOutputTokens(): number | undefined;
  createResearchService(): ResearchService;
  saveCurrentChat(): Promise<void>;
  setProgressStatus(message: string | null): void;
  renderMessages(): void;
}

/** Coordinates context-driven chat-history compaction and its user-visible status. */
export class ChatHistoryCompactor {
  constructor(private readonly options: ChatHistoryCompactorOptions) {}

  async compactIfNeeded(question: string): Promise<boolean> {
    if (
      !shouldCompactForContext({
        question,
        messages: this.options.getMessages(),
        contextLimitTokens: this.options.getContextLimitTokens(),
        reservedOutputTokens: this.options.getReservedOutputTokens(),
      })
    ) {
      return false;
    }

    return this.compactHistory({ automatic: true });
  }

  async compactHistory(options: { automatic: boolean }): Promise<boolean> {
    const messages = this.options.getMessages();
    const compactable = compactableMessages(messages);

    if (compactable.length === 0) {
      const message = "There is not enough older chat history to compact.";
      this.options.setProgressStatus(message);
      new Notice(message);
      return false;
    }

    const status = options.automatic
      ? "Automatically compacting context to preserve evidence budget..."
      : "Compacting chat history...";
    this.options.setProgressStatus(status);
    if (options.automatic) {
      this.options.setMessages([
        ...messages,
        {
          role: "assistant",
          content: "Automatically compacting context to preserve evidence budget.",
          createdAt: new Date().toISOString(),
        },
      ]);
      this.options.renderMessages();
      await this.options.saveCurrentChat();
    }

    try {
      const sourceMessages = options.automatic
        ? compactableMessages(this.options.getMessages())
        : compactable;
      const summary = await this.options
        .createResearchService()
        .summarizeChatHistoryForCompaction(
          sourceMessages,
          compactionSummaryFromMessages(this.options.getMessages()),
        );
      const result = compactChatMessages(this.options.getMessages(), { summary });

      if (!result.changed) {
        return false;
      }

      this.options.setMessages(result.messages);
      await this.options.saveCurrentChat();
      this.options.renderMessages();
      const done = `Compacted ${result.compactedCount} older message(s).`;
      this.options.setProgressStatus(done);
      new Notice(done);
      return true;
    } catch (error) {
      const message = toUserMessage(error);
      this.options.setProgressStatus(message);
      new Notice(message);
      return false;
    }
  }
}
