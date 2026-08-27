import { Notice } from "obsidian";

import { chatHistoryForPrompt } from "@application/use-cases/chat";
import type { ChatRunRequest, ChatRunStartResult } from "@application/use-cases/chat";
import { ResearchService } from "@application/use-cases/research";
import { estimateResearchRequestTokens } from "@core/research";
import { ChatDisplayMessage } from "@core/conversation";
import type { Translate } from "@adapters/i18n";
import { ChatHistoryCompactor } from "./ChatHistoryCompactor";

export interface ResearchQuestionControllerOptions {
  getQuestionInput(): string;
  clearQuestionInput(): void;
  getMessages(): ChatDisplayMessage[];
  setMessages(messages: ChatDisplayMessage[]): void;
  getModelInputValue(): string;
  getCurrentModel(): string;
  getCurrentModelLabel(): string;
  getContextLimitTokens(): number | undefined;
  getReservedOutputTokens(): number | undefined;
  isRunning(): boolean;
  updateChatModel(model: string): Promise<void>;
  saveCurrentChat(): Promise<void>;
  createResearchService(): ResearchService;
  startRun(request: ChatRunRequest): Promise<ChatRunStartResult>;
  stopRun(): void;
  getActiveFilePath(): string | undefined;
  shouldIncludeActiveFileContext(): boolean;
  shouldIncludeContextDiagnostics(): boolean;
  getContextPaths(): string[];
  clearContextPaths(): void;
  getSearchUnavailableMessage(): string | null;
  setEditingMessageIndex(index: number | null): void;
  setProgressStatus(message: string | null): void;
  renderMessages(): void;
  t: Translate;
}

/**
 * Turns composer input into a run request for the plugin-owned session
 * manager. It validates the question, compacts history when the context window
 * demands it, and never owns the run itself.
 */
export class ResearchQuestionController {
  private readonly options: ResearchQuestionControllerOptions;
  private readonly historyCompactor: ChatHistoryCompactor;

  constructor(options: ResearchQuestionControllerOptions) {
    this.options = options;
    this.historyCompactor = new ChatHistoryCompactor(options);
  }

  isRunning(): boolean {
    return this.options.isRunning();
  }

  async submitQuestion(): Promise<void> {
    const question = this.options.getQuestionInput().trim();

    if (!question || this.isRunning()) {
      return;
    }

    if (question === "/compact") {
      this.options.clearQuestionInput();
      await this.historyCompactor.compactHistory({ automatic: false });
      return;
    }

    if (this.options.getSearchUnavailableMessage() !== null) {
      return;
    }

    const chatHistory = this.options.getMessages();
    if (await this.historyCompactor.compactIfNeeded(question)) {
      return this.submitQuestion();
    }

    if (this.rejectIfContextWindowExceeded(question, chatHistory)) {
      return;
    }

    await this.runQuestion(question, { appendQuestion: true, chatHistory });
  }

  async submitEditedQuestion(index: number, value: string): Promise<void> {
    const question = value.trim();

    if (!question || this.isRunning() || this.options.getSearchUnavailableMessage() !== null) {
      return;
    }

    const messages = this.options.getMessages();
    const hasAnswer = messages[index + 1]?.role === "assistant";
    const chatHistory = hasAnswer ? messages : messages.slice(0, Math.max(0, index));

    if (await this.historyCompactor.compactIfNeeded(question)) {
      return;
    }

    if (this.rejectIfContextWindowExceeded(question, chatHistory)) {
      return;
    }

    this.options.setEditingMessageIndex(null);

    if (hasAnswer) {
      await this.runQuestion(question, { appendQuestion: true, chatHistory });
      return;
    }

    const pendingContextPaths = this.options.getContextPaths();
    const contextPaths =
      pendingContextPaths.length > 0 ? pendingContextPaths : (messages[index]?.contextPaths ?? []);
    this.options.setMessages(
      messages.map((message, messageIndex) =>
        messageIndex === index
          ? {
              ...message,
              content: question,
              ...(contextPaths.length > 0 ? { contextPaths } : {}),
            }
          : message,
      ),
    );
    this.options.clearContextPaths();
    await this.options.saveCurrentChat();
    await this.runQuestion(question, { appendQuestion: false, chatHistory, contextPaths });
  }

  stopRunningQuestion(): void {
    this.options.stopRun();
  }

  private async runQuestion(
    question: string,
    options: {
      appendQuestion: boolean;
      chatHistory: ChatDisplayMessage[];
      contextPaths?: string[];
    },
  ): Promise<void> {
    const contextPaths = options.contextPaths ?? this.options.getContextPaths();
    await this.options.updateChatModel(
      this.options.getModelInputValue() || this.options.getCurrentModel(),
    );
    this.options.setProgressStatus(null);

    const result = await this.options.startRun({
      question,
      chatHistory: options.chatHistory,
      appendQuestion: options.appendQuestion,
      contextPaths,
      activeFilePath: this.options.getActiveFilePath(),
      includeActiveFile: this.options.shouldIncludeActiveFileContext(),
      includeContextDiagnostics: this.options.shouldIncludeContextDiagnostics(),
      modelLabel: this.options.getCurrentModelLabel(),
    });

    if (!result.started) {
      if (result.error !== undefined) {
        const message = this.options.t("chat.session.startFailed");
        this.options.setProgressStatus(message);
        new Notice(message);
      }
      return;
    }

    this.options.clearQuestionInput();
    this.options.clearContextPaths();
  }

  private rejectIfContextWindowExceeded(
    question: string,
    chatHistory: ChatDisplayMessage[],
  ): boolean {
    const limit = this.options.getContextLimitTokens();

    if (!limit) {
      return false;
    }

    const estimatedTokens = estimateResearchRequestTokens({
      question,
      chatHistory: chatHistoryForPrompt(chatHistory),
      evidence: [],
      maxEvidenceItems: 0,
      reservedOutputTokens: this.options.getReservedOutputTokens(),
    });

    if (estimatedTokens <= limit) {
      return false;
    }

    const message = this.options.t("chat.research.contextTooLong");
    this.options.setProgressStatus(message);
    new Notice(message);
    return true;
  }
}
