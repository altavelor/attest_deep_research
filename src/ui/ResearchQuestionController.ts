import { Notice } from "obsidian";

import { ResearchService, ResearchStreamEvent } from "../research/ResearchService";
import {
  estimateResearchRequestTokens,
  ResearchChatHistoryMessage,
} from "../research/prompts";
import type { ResearchSearchMode } from "../research/ResearchService";
import { toUserMessage } from "../shared/errors";
import { ResearchAnswer, RetrievedChunk } from "../shared/types";
import { ChatDisplayMessage, nextAssistantMessage } from "./rendering";

export interface ResearchQuestionControllerOptions {
  getQuestionInput(): string;
  clearQuestionInput(): void;
  getMessages(): ChatDisplayMessage[];
  setMessages(messages: ChatDisplayMessage[]): void;
  getLastAnswer(): ResearchAnswer | null;
  setLastAnswer(answer: ResearchAnswer | null): void;
  getModelInputValue(): string;
  getCurrentModel(): string;
  getContextLimitTokens(): number | undefined;
  getReservedOutputTokens(): number | undefined;
  updateChatModel(model: string): Promise<void>;
  saveCurrentChat(): Promise<void>;
  createResearchService(): ResearchService;
  getSearchMode(): ResearchSearchMode;
  isDeepResearchEnabled(): boolean;
  getContextPaths(): string[];
  getSearchUnavailableMessage(): string | null;
  setEditingMessageIndex(index: number | null): void;
  setProgressStatus(message: string | null): void;
  setFormRunning(running: boolean): void;
  setRunningState(running: boolean): void;
  renderMessages(): void;
  renderAnswerDetails(): void;
  renderIndexControl(): void;
}

export class ResearchQuestionController {
  private readonly options: ResearchQuestionControllerOptions;
  private shouldStopRunning = false;
  private running = false;

  constructor(options: ResearchQuestionControllerOptions) {
    this.options = options;
  }

  isRunning(): boolean {
    return this.running;
  }

  async submitQuestion(): Promise<void> {
    const question = this.options.getQuestionInput().trim();

    if (!question || this.running || this.options.getSearchUnavailableMessage() !== null) {
      return;
    }

    const chatHistory = this.options.getMessages();
    if (this.rejectIfContextWindowExceeded(question, chatHistory)) {
      return;
    }

    this.options.clearQuestionInput();
    await this.runQuestion(question, { appendQuestion: true, chatHistory });
  }

  async submitEditedQuestion(index: number, value: string): Promise<void> {
    const question = value.trim();

    if (!question || this.running || this.options.getSearchUnavailableMessage() !== null) {
      return;
    }

    const messages = this.options.getMessages();
    const hasAnswer = messages[index + 1]?.role === "assistant";
    const chatHistory = hasAnswer ? messages : messages.slice(0, Math.max(0, index));

    if (this.rejectIfContextWindowExceeded(question, chatHistory)) {
      return;
    }

    this.options.setEditingMessageIndex(null);

    if (hasAnswer) {
      await this.runQuestion(question, { appendQuestion: true, chatHistory });
      return;
    }

    this.options.setMessages(
      messages.map((message, messageIndex) =>
        messageIndex === index ? { ...message, content: question } : message,
      ),
    );
    await this.options.saveCurrentChat();
    await this.runQuestion(question, { appendQuestion: false, chatHistory });
  }

  stopRunningQuestion(): void {
    if (!this.running) {
      return;
    }

    this.shouldStopRunning = true;
  }

  private async runQuestion(
    question: string,
    options: {
      appendQuestion: boolean;
      chatHistory: ChatDisplayMessage[];
    },
  ): Promise<void> {
    this.setRunning(true);
    this.shouldStopRunning = false;
    await this.options.updateChatModel(
      this.options.getModelInputValue() || this.options.getCurrentModel(),
    );
    this.options.setFormRunning(true);
    if (options.appendQuestion) {
      this.options.setMessages([
        ...this.options.getMessages(),
        { role: "user", content: question, createdAt: new Date().toISOString() },
      ]);
      await this.options.saveCurrentChat();
    }
    this.options.setLastAnswer(null);
    this.options.renderMessages();
    this.options.renderAnswerDetails();
    this.options.setProgressStatus(null);

    try {
      const service = this.options.createResearchService();
      const contextPaths = this.options.getContextPaths();

      for await (const event of service.answer({
        question,
        searchMode: this.options.getSearchMode(),
        deepResearch: this.options.isDeepResearchEnabled(),
        contextPaths: contextPaths.length > 0 ? contextPaths : undefined,
        chatHistory: toResearchChatHistory(options.chatHistory),
      })) {
        if (this.shouldStopRunning) {
          break;
        }
        this.applyResearchEvent(event);
      }
    } catch (error) {
      this.options.setMessages(
        nextAssistantMessage(this.options.getMessages(), toUserMessage(error)),
      );
      await this.options.saveCurrentChat();
      new Notice(toUserMessage(error));
      this.options.renderMessages();
    } finally {
      this.shouldStopRunning = false;
      this.setRunning(false);
      this.options.setProgressStatus(null);
      this.options.setFormRunning(false);
      this.options.renderIndexControl();
    }
  }

  private applyResearchEvent(event: ResearchStreamEvent): void {
    if (event.type === "status") {
      this.options.setProgressStatus(event.message);
      return;
    }

    if (event.type === "delta") {
      this.options.setMessages(nextAssistantMessage(this.options.getMessages(), event.content));
      this.options.renderMessages();
      return;
    }

    this.options.setLastAnswer(event.answer);
    this.options.setMessages(
      attachEvidenceToLastAssistantMessage(
        this.options.getMessages(),
        event.answer.evidence ?? [],
      ),
    );
    this.options.renderAnswerDetails();
    this.options.renderMessages();
    void this.options.saveCurrentChat();
  }

  private setRunning(running: boolean): void {
    this.running = running;
    this.options.setRunningState(running);
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
      chatHistory: toResearchChatHistory(chatHistory),
      evidence: [],
      maxEvidenceItems: 0,
      reservedOutputTokens: this.options.getReservedOutputTokens(),
    });

    if (estimatedTokens <= limit) {
      return false;
    }

    const message = "The current chat is too long for the selected model context window.";
    this.options.setProgressStatus(message);
    new Notice(message);
    return true;
  }
}

function toResearchChatHistory(messages: ChatDisplayMessage[]): ResearchChatHistoryMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function attachEvidenceToLastAssistantMessage(
  messages: ChatDisplayMessage[],
  evidence: RetrievedChunk[],
): ChatDisplayMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") {
      continue;
    }

    return [
      ...messages.slice(0, index),
      { ...messages[index], evidence },
      ...messages.slice(index + 1),
    ];
  }

  return messages;
}
