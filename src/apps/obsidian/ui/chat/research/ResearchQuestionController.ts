import { Notice } from "obsidian";

import { chatHistoryForPrompt } from "@application/use-cases/chat";
import {
  AgentRunDiagnosticCollector,
  ResearchService,
  ResearchStreamEvent,
} from "@application/use-cases/research";
import { estimateResearchRequestTokens, parseSubAgentDirective } from "@core/research";
import type { ResearchSearchMode } from "@application/use-cases/research";
import type { ResearchMode } from "@core/research";
import type { ContextMode } from "@core/diagnostics";
import { toUserMessage } from "@core/errors";
import { ResearchAnswer } from "@core/answer";
import { ChatDisplayMessage } from "@core/conversation";
import {
  attachAnswerDetailsToLastAssistantMessage,
  completeAssistantCheckpoint,
  finalizeLastAssistantReasoning,
  interruptLastAssistantProgress,
  nextAssistantCheckpoint,
  nextAssistantMessage,
  nextAssistantReasoning,
  nextChainSubAgentPhase,
  nextChainReasoningSegment,
  nextChainToolCallEnd,
  nextChainToolCallStart,
  nextUserMessage,
  resetLastAssistantContent,
  promoteAssistantCheckpoint,
  startAssistantProgress,
  stampLastAssistantModel,
} from "@core/conversation";
import { ChatHistoryCompactor } from "./ChatHistoryCompactor";

export interface ResearchQuestionControllerOptions {
  getQuestionInput(): string;
  clearQuestionInput(): void;
  getMessages(): ChatDisplayMessage[];
  setMessages(messages: ChatDisplayMessage[]): void;
  getLastAnswer(): ResearchAnswer | null;
  setLastAnswer(answer: ResearchAnswer | null): void;
  getModelInputValue(): string;
  getCurrentModel(): string;
  getCurrentModelLabel(): string;
  getContextLimitTokens(): number | undefined;
  getReservedOutputTokens(): number | undefined;
  updateChatModel(model: string): Promise<void>;
  saveCurrentChat(): Promise<void>;
  createResearchService(): ResearchService;
  getSearchMode(): ResearchSearchMode;
  getResearchMode(): ResearchMode;
  getContextMode(): ContextMode;
  getActiveFilePath(): string | undefined;
  shouldIncludeActiveFileContext(): boolean;
  shouldIncludeContextDiagnostics(): boolean;
  getContextPaths(): string[];
  clearContextPaths(): void;
  getSearchUnavailableMessage(): string | null;
  setEditingMessageIndex(index: number | null): void;
  setProgressStatus(message: string | null): void;
  setFormRunning(running: boolean): void;
  setRunningState(running: boolean): void;
  renderMessages(): void;
  renderActiveMessage(): void;
  renderAnswerDetails(): void;
}

export class ResearchQuestionController {
  private readonly options: ResearchQuestionControllerOptions;
  private shouldStopRunning = false;
  private activeAbortController: AbortController | null = null;
  private activeRunId: string | null = null;
  private running = false;
  private activeDiagnostics: AgentRunDiagnosticCollector | null = null;
  private activeRenderHandle: number | null = null;
  private readonly historyCompactor: ChatHistoryCompactor;

  constructor(options: ResearchQuestionControllerOptions) {
    this.options = options;
    this.historyCompactor = new ChatHistoryCompactor(options);
  }

  isRunning(): boolean {
    return this.running;
  }

  async submitQuestion(): Promise<void> {
    const question = this.options.getQuestionInput().trim();

    if (!question || this.running) {
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
    if (!this.running) {
      return;
    }

    this.shouldStopRunning = true;
    this.activeAbortController?.abort(new DOMException("Cancelled by user", "AbortError"));
  }

  private async runQuestion(
    question: string,
    options: {
      appendQuestion: boolean;
      chatHistory: ChatDisplayMessage[];
      contextPaths?: string[];
    },
  ): Promise<void> {
    const runId = createRunId();
    const runDiagnostics = new AgentRunDiagnosticCollector({
      runId,
      answerId: `answer-${runId}`,
    });
    this.activeRunId = runId;
    this.activeDiagnostics = runDiagnostics;
    this.setRunning(true);
    this.shouldStopRunning = false;
    this.activeAbortController = new AbortController();
    const contextPaths = options.contextPaths ?? this.options.getContextPaths();
    await this.options.updateChatModel(
      this.options.getModelInputValue() || this.options.getCurrentModel(),
    );
    this.options.setFormRunning(true);
    if (options.appendQuestion) {
      this.options.setMessages(nextUserMessage(this.options.getMessages(), question, contextPaths));
      this.options.clearContextPaths();
      await this.options.saveCurrentChat();
    }
    this.options.setMessages(startAssistantProgress(this.options.getMessages()));
    this.options.setLastAnswer(null);
    this.options.renderMessages();
    this.options.renderAnswerDetails();
    this.options.setProgressStatus(null);

    try {
      const service = this.options.createResearchService();
      const { forceSubAgent, cleanedQuestion } = parseSubAgentDirective(question);
      let completed = false;

      for await (const event of service.answer({
        question: cleanedQuestion || question,
        forceSubAgent: forceSubAgent || undefined,
        mode: forceSubAgent ? "thinking" : this.options.getResearchMode(),
        searchMode: this.options.getSearchMode(),
        contextMode: this.options.getContextMode(),
        contextPaths: contextPaths.length > 0 ? contextPaths : undefined,
        activeFilePath: this.options.getActiveFilePath(),
        includeActiveFile: this.options.shouldIncludeActiveFileContext(),
        includeContextDiagnostics: this.options.shouldIncludeContextDiagnostics(),
        chatHistory: chatHistoryForPrompt(options.chatHistory),
        signal: this.activeAbortController.signal,
      })) {
        if (this.shouldStopRunning || this.activeRunId !== runId) {
          break;
        }
        runDiagnostics.record(event);
        if (event.type === "complete" && event.answer.contextDiagnostics) {
          runDiagnostics.complete(event.answer.contextDiagnostics);
        }
        await this.applyResearchEvent(event, runId);
        if (event.type === "complete") {
          completed = true;
        }
      }
      if (!completed) {
        this.options.setMessages(interruptLastAssistantProgress(this.options.getMessages()));
        this.options.renderActiveMessage();
        await this.options.saveCurrentChat();
      }
    } catch (error) {
      const finalizedMessages = interruptLastAssistantProgress(this.options.getMessages());
      this.options.setMessages(nextAssistantMessage(finalizedMessages, toUserMessage(error)));
      await this.options.saveCurrentChat();
      new Notice(toUserMessage(error));
      this.options.renderMessages();
    } finally {
      this.shouldStopRunning = false;
      this.cancelActiveRender();
      if (this.activeRunId === runId) {
        this.activeAbortController = null;
        this.activeRunId = null;
      }
      this.activeDiagnostics = null;
      this.setRunning(false);
      this.options.setProgressStatus(null);
      this.options.setFormRunning(false);
    }
  }

  private async applyResearchEvent(event: ResearchStreamEvent, runId: string): Promise<void> {
    if (this.activeRunId !== runId) return;
    if (event.type === "status") {
      this.options.setProgressStatus(event.message);
      return;
    }

    if (event.type === "context") {
      return;
    }

    if (event.type === "delta") {
      this.options.setMessages(nextAssistantMessage(this.options.getMessages(), event.content));
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "reasoning") {
      let msgs = nextAssistantReasoning(this.options.getMessages(), event.segmentId, event.content);
      msgs = nextChainReasoningSegment(msgs, event.segmentId, event.content);
      this.options.setMessages(msgs);
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "tool-call-start") {
      this.options.setMessages(
        nextChainToolCallStart(
          this.options.getMessages(),
          event.id,
          event.name,
          event.label,
          event.args,
          event.parentId,
          event.fetchTargets,
          event.searchSources,
        ),
      );
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "tool-call-end") {
      this.options.setMessages(
        nextChainToolCallEnd(
          this.options.getMessages(),
          event.id,
          event.ok,
          event.resolvedLabel,
          event.resultSummary,
          event.resultJson,
          event.parentId,
        ),
      );
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "sub-agent-phase") {
      this.options.setMessages(
        nextChainSubAgentPhase(this.options.getMessages(), event.parentId, event.phase),
      );
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "checkpoint-delta") {
      this.options.setMessages(
        nextAssistantCheckpoint(
          this.options.getMessages(),
          event.checkpointId,
          event.round,
          event.content,
        ),
      );
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "checkpoint-complete") {
      this.options.setMessages(
        completeAssistantCheckpoint(this.options.getMessages(), event.checkpointId),
      );
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "checkpoint-promote") {
      this.options.setMessages(
        promoteAssistantCheckpoint(this.options.getMessages(), event.checkpointId),
      );
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "answer-reset") {
      this.cancelActiveRender();
      this.options.setMessages(resetLastAssistantContent(this.options.getMessages()));
      this.options.renderMessages();
      return;
    }

    if (this.hasFinalizingCheckpoint()) {
      await this.waitForFinalizingFrame();
      if (this.activeRunId !== runId) return;
    }
    this.cancelActiveRender();
    this.options.setLastAnswer(event.answer);
    this.options.setMessages(finalizeLastAssistantReasoning(this.options.getMessages()));
    this.options.setMessages(
      stampLastAssistantModel(this.options.getMessages(), this.options.getCurrentModelLabel()),
    );
    this.options.setMessages(
      attachAnswerDetailsToLastAssistantMessage(this.options.getMessages(), {
        finalAnswer: event.answer,
        ...event.answer,
        ...(event.answer.isFallback
          ? { isFallback: true as const, fallbackReason: event.answer.fallbackReason }
          : {}),
      }),
    );
    this.options.renderAnswerDetails();
    this.options.renderMessages();
    void this.options.saveCurrentChat();
  }

  private setRunning(running: boolean): void {
    this.running = running;
    this.options.setRunningState(running);
  }

  /**
   * Coalesce high-frequency streaming renders. The message state is updated
   * synchronously by the caller; the (expensive) active-message render is
   * deferred to the next animation frame so a burst of deltas results in a
   * single render rather than one per delta.
   */
  private scheduleActiveRender(): void {
    if (this.activeRenderHandle !== null) {
      this.activeDiagnostics?.recordCoalescedUpdate();
      return;
    }
    const flush = () => {
      this.activeRenderHandle = null;
      this.activeDiagnostics?.recordMarkdownRender();
      this.options.renderActiveMessage();
    };
    this.activeRenderHandle =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(flush)
        : (setTimeout(flush, 16) as unknown as number);
  }

  private cancelActiveRender(): void {
    if (this.activeRenderHandle === null) return;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.activeRenderHandle);
    } else {
      clearTimeout(this.activeRenderHandle);
    }
    this.activeRenderHandle = null;
  }

  private hasFinalizingCheckpoint(): boolean {
    return Boolean(
      this.options
        .getMessages()
        .at(-1)
        ?.researchProgress?.checkpoints.some((checkpoint) => checkpoint.status === "finalizing"),
    );
  }

  private waitForFinalizingFrame(): Promise<void> {
    return new Promise((resolve) => {
      let completed = false;
      const finish = (): void => {
        if (completed) return;
        completed = true;
        window.clearTimeout(fallbackTimer);
        resolve();
      };
      const fallbackTimer = window.setTimeout(finish, 50);
      window.requestAnimationFrame(finish);
    });
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

    const message = "The current chat is too long for the selected model context window.";
    this.options.setProgressStatus(message);
    new Notice(message);
    return true;
  }
}

let runSequence = 0;

function createRunId(): string {
  runSequence += 1;
  return `${Date.now().toString(36)}-${runSequence.toString(36)}`;
}
