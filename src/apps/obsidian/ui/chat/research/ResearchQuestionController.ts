import { Notice } from "obsidian";

import {
  chatHistoryForPrompt,
  compactableMessages,
  compactChatMessages,
  compactionSummaryFromMessages,
  shouldCompactForContext,
} from "@application/use-cases/chat";
import {
  AgentRunDiagnosticCollector,
  ResearchService,
  ResearchStreamEvent,
} from "@application/use-cases/research";
import { estimateResearchRequestTokens, parseDeepResearchDirective } from "@core/research";
import type { ResearchSearchMode } from "@application/use-cases/research";
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
  nextChainDeepResearchPhase,
  nextChainReasoningSegment,
  nextChainToolCallEnd,
  nextChainToolCallStart,
  resetLastAssistantContent,
  stampLastAssistantModel,
} from "@core/conversation";

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
  getContextMode(): ContextMode;
  getActiveFilePath(): string | undefined;
  shouldIncludeActiveFileContext(): boolean;
  shouldIncludeContextDiagnostics(): boolean;
  getContextPaths(): string[];
  getSearchUnavailableMessage(): string | null;
  setEditingMessageIndex(index: number | null): void;
  setProgressStatus(message: string | null): void;
  setFormRunning(running: boolean): void;
  setRunningState(running: boolean): void;
  renderMessages(): void;
  renderActiveMessage(): void;
  renderAnswerDetails(): void;
  renderIndexControl(): void;
}

export class ResearchQuestionController {
  private readonly options: ResearchQuestionControllerOptions;
  private shouldStopRunning = false;
  private activeAbortController: AbortController | null = null;
  private activeRunId: string | null = null;
  private running = false;
  private activeDiagnostics: AgentRunDiagnosticCollector | null = null;
  private activeRenderHandle: number | null = null;

  constructor(options: ResearchQuestionControllerOptions) {
    this.options = options;
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
      await this.compactHistory({ automatic: false });
      return;
    }

    if (this.options.getSearchUnavailableMessage() !== null) {
      return;
    }

    const chatHistory = this.options.getMessages();
    if (await this.compactIfNeeded(question)) {
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

    if (await this.compactIfNeeded(question)) {
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
    this.activeAbortController?.abort(new DOMException("Cancelled by user", "AbortError"));
  }

  private async runQuestion(
    question: string,
    options: {
      appendQuestion: boolean;
      chatHistory: ChatDisplayMessage[];
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
      const { forceDeepSearch, cleanedQuestion } = parseDeepResearchDirective(question);
      let completed = false;

      for await (const event of service.answer({
        question: cleanedQuestion || question,
        forceDeepSearch: forceDeepSearch || undefined,
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
        this.applyResearchEvent(event, runId);
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
      this.options.renderIndexControl();
    }
  }

  private applyResearchEvent(event: ResearchStreamEvent, runId: string): void {
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

    if (event.type === "deep-research-phase") {
      this.options.setMessages(
        nextChainDeepResearchPhase(this.options.getMessages(), event.parentId, event.phase),
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
      const messages = this.options.getMessages();
      const last = messages.at(-1);
      const checkpoint = last?.researchProgress?.checkpoints.find(
        (item) => item.id === event.checkpointId,
      );
      if (checkpoint && last?.researchProgress) {
        const updated = [
          ...messages.slice(0, -1),
          {
            ...last,
            researchProgress: {
              ...last.researchProgress,
              checkpoints: last.researchProgress.checkpoints.filter(
                (item) => item.id !== event.checkpointId,
              ),
            },
          },
        ];
        this.options.setMessages(nextAssistantMessage(updated, checkpoint.content));
      }
      this.scheduleActiveRender();
      return;
    }

    if (event.type === "answer-reset") {
      this.cancelActiveRender();
      this.options.setMessages(resetLastAssistantContent(this.options.getMessages()));
      this.options.renderMessages();
      return;
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

  private async compactIfNeeded(question: string): Promise<boolean> {
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

  private async compactHistory(options: { automatic: boolean }): Promise<boolean> {
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

let runSequence = 0;

function createRunId(): string {
  runSequence += 1;
  return `${Date.now().toString(36)}-${runSequence.toString(36)}`;
}
