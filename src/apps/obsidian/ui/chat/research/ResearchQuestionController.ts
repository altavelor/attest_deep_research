import { Notice } from "obsidian";

import { chatHistoryForPrompt } from "@application/use-cases/chat";
import type { ChatRunRequest, ChatRunStartResult } from "@application/use-cases/chat";
import { ResearchService } from "@application/use-cases/research";
import { estimateResearchRequestTokens } from "@core/research";
import { ChatDisplayMessage } from "@core/conversation";
import type { Translate } from "@adapters/i18n";
import { ChatHistoryCompactor } from "./ChatHistoryCompactor";

export interface ResearchQuestionControllerOptions {
  getSessionId(): string;
  isSessionDisplayed(sessionId: string): boolean;
  getQuestionInput(): string;
  clearQuestionInput(): void;
  getMessages(sessionId: string): ChatDisplayMessage[];
  setMessages(sessionId: string, messages: ChatDisplayMessage[]): void;
  getModelInputValue(): string;
  getCurrentModel(sessionId: string): string;
  getCurrentModelLabel(sessionId: string): string;
  getContextLimitTokens(sessionId: string): number | undefined;
  getReservedOutputTokens(sessionId: string): number | undefined;
  isRunning(): boolean;
  updateChatModel(sessionId: string, model: string): Promise<void>;
  saveCurrentChat(sessionId: string): Promise<void>;
  createResearchService(sessionId: string): ResearchService;
  startRun(sessionId: string, request: ChatRunRequest): Promise<ChatRunStartResult>;
  stopRun(): void;
  getActiveFilePath(): string | undefined;
  shouldIncludeActiveFileContext(): boolean;
  shouldIncludeContextDiagnostics(): boolean;
  getContextPaths(sessionId: string): string[];
  clearContextPaths(sessionId: string): void;
  getSearchUnavailableMessage(): string | null;
  setEditingMessageIndex(index: number | null): void;
  setProgressStatus(message: string | null): void;
  renderMessages(): void;
  t: Translate;
}

/**
 * Turns composer input into a run request for the plugin-owned session
 * manager. It binds the whole submission to the session that started it, so an
 * intervening chat switch cannot redirect the question, and never owns the run.
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
    const sessionId = this.options.getSessionId();
    const question = this.options.getQuestionInput().trim();
    const model = this.options.getModelInputValue();

    if (!question || this.isRunning()) {
      return;
    }

    if (question === "/compact") {
      this.options.clearQuestionInput();
      await this.historyCompactor.compactHistory(sessionId, { automatic: false });
      return;
    }

    if (this.options.getSearchUnavailableMessage() !== null) {
      return;
    }

    const chatHistory = this.options.getMessages(sessionId);
    if (await this.historyCompactor.compactIfNeeded(sessionId, question)) {
      return this.submitQuestion();
    }

    if (this.rejectIfContextWindowExceeded(sessionId, question, chatHistory)) {
      return;
    }

    await this.runQuestion(sessionId, question, model, { appendQuestion: true, chatHistory });
  }

  async submitEditedQuestion(index: number, value: string): Promise<void> {
    const sessionId = this.options.getSessionId();
    const question = value.trim();
    const model = this.options.getModelInputValue();

    if (!question || this.isRunning() || this.options.getSearchUnavailableMessage() !== null) {
      return;
    }

    const messages = this.options.getMessages(sessionId);
    const hasAnswer = messages[index + 1]?.role === "assistant";
    const chatHistory = hasAnswer ? messages : messages.slice(0, Math.max(0, index));

    if (await this.historyCompactor.compactIfNeeded(sessionId, question)) {
      return;
    }

    if (this.rejectIfContextWindowExceeded(sessionId, question, chatHistory)) {
      return;
    }

    this.options.setEditingMessageIndex(null);

    if (hasAnswer) {
      await this.runQuestion(sessionId, question, model, { appendQuestion: true, chatHistory });
      return;
    }

    const pendingContextPaths = this.options.getContextPaths(sessionId);
    const contextPaths =
      pendingContextPaths.length > 0 ? pendingContextPaths : (messages[index]?.contextPaths ?? []);
    this.options.setMessages(
      sessionId,
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
    this.clearContextPaths(sessionId);
    await this.options.saveCurrentChat(sessionId);
    await this.runQuestion(sessionId, question, model, {
      appendQuestion: false,
      chatHistory,
      contextPaths,
    });
  }

  stopRunningQuestion(): void {
    this.options.stopRun();
  }

  private async runQuestion(
    sessionId: string,
    question: string,
    model: string,
    options: {
      appendQuestion: boolean;
      chatHistory: ChatDisplayMessage[];
      contextPaths?: string[];
    },
  ): Promise<void> {
    const contextPaths = options.contextPaths ?? this.options.getContextPaths(sessionId);
    await this.options.updateChatModel(sessionId, model || this.options.getCurrentModel(sessionId));
    this.setProgressStatus(sessionId, null);

    const result = await this.options.startRun(sessionId, {
      question,
      chatHistory: options.chatHistory,
      appendQuestion: options.appendQuestion,
      contextPaths,
      activeFilePath: this.options.getActiveFilePath(),
      includeActiveFile: this.options.shouldIncludeActiveFileContext(),
      includeContextDiagnostics: this.options.shouldIncludeContextDiagnostics(),
      modelLabel: this.options.getCurrentModelLabel(sessionId),
    });

    if (!result.started) {
      if (result.error !== undefined) {
        const message = this.options.t("chat.session.startFailed");
        this.setProgressStatus(sessionId, message);
        new Notice(message);
      }
      return;
    }

    if (this.options.isSessionDisplayed(sessionId)) {
      this.options.clearQuestionInput();
    }
    this.clearContextPaths(sessionId);
  }

  private rejectIfContextWindowExceeded(
    sessionId: string,
    question: string,
    chatHistory: ChatDisplayMessage[],
  ): boolean {
    const limit = this.options.getContextLimitTokens(sessionId);

    if (!limit) {
      return false;
    }

    const estimatedTokens = estimateResearchRequestTokens({
      question,
      chatHistory: chatHistoryForPrompt(chatHistory),
      evidence: [],
      maxEvidenceItems: 0,
      reservedOutputTokens: this.options.getReservedOutputTokens(sessionId),
    });

    if (estimatedTokens <= limit) {
      return false;
    }

    const message = this.options.t("chat.research.contextTooLong");
    this.setProgressStatus(sessionId, message);
    new Notice(message);
    return true;
  }

  private clearContextPaths(sessionId: string): void {
    this.options.clearContextPaths(sessionId);
  }

  private setProgressStatus(sessionId: string, message: string | null): void {
    if (!this.options.isSessionDisplayed(sessionId)) return;
    this.options.setProgressStatus(message);
  }
}
