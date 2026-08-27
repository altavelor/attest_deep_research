import {
  AgentRunDiagnosticCollector,
  type ResearchStreamEvent,
} from "@application/use-cases/research";
import { chatHistoryForPrompt } from "./ChatCompaction";
import { parseSubAgentDirective } from "@core/research";
import type { ResearchMode } from "@core/research";
import { ResearchAnswer } from "@core/answer";
import {
  attachAnswerDetailsToLastAssistantMessage,
  completeAssistantCheckpoint,
  finalizeLastAssistantReasoning,
  nextAssistantCheckpoint,
  nextAssistantMessage,
  nextAssistantReasoning,
  nextChainSubAgentPhase,
  nextChainReasoningSegment,
  nextChainToolCallEnd,
  nextChainToolCallStart,
  resetLastAssistantContent,
  promoteAssistantCheckpoint,
  stampLastAssistantModel,
} from "@core/conversation";
import {
  bindAnswerToConversationRegistry,
  recordConversationCitationUsages,
  registerConversationEvidence,
} from "@core/chat/sourceRegistry";
import type {
  ChatRunRequest,
  ChatSessionChangeKind,
  ChatSessionEnvironment,
  ChatSessionState,
} from "./chatSessionTypes";

export interface ChatSessionRuntimeHost {
  environment: ChatSessionEnvironment;
  emit(sessionId: string, kind: ChatSessionChangeKind): void;
}

/**
 * Executes one run of one chat session. It owns the abort controller and the
 * stream iterator, applies every event to the session state under a run fence,
 * and never touches presentation.
 */
export class ChatSessionRuntime {
  private controller: AbortController | null = null;
  private diagnostics: AgentRunDiagnosticCollector | null = null;
  private fencedRunIds = new Set<string>();

  constructor(
    readonly state: ChatSessionState,
    private readonly host: ChatSessionRuntimeHost,
  ) {}

  get abortSignal(): AbortSignal | null {
    return this.controller?.signal ?? null;
  }

  /** Rejects every further event of `runId`, whether or not the iterator stopped. */
  fence(runId: string): void {
    this.fencedRunIds.add(runId);
  }

  isFenced(runId: string): boolean {
    return this.fencedRunIds.has(runId) || this.state.activeRunId !== runId;
  }

  abort(): void {
    this.controller?.abort(new DOMException("Cancelled by user", "AbortError"));
  }

  /**
   * Consumes the research stream until it completes, fails, or is aborted.
   * Resolves with the outcome so the manager can persist it and release the
   * execution slot; it never throws.
   */
  async execute(
    request: ChatRunRequest,
    runId: string,
  ): Promise<{ outcome: "completed" | "failed" | "interrupted"; error?: unknown }> {
    this.controller = new AbortController();
    const diagnostics = new AgentRunDiagnosticCollector({
      runId,
      answerId: `answer-${runId}`,
    });
    this.diagnostics = diagnostics;
    const { forceSubAgent, cleanedQuestion } = parseSubAgentDirective(request.question);
    const mode: ResearchMode = forceSubAgent
      ? "thinking"
      : (this.state.chatSettings.researchMode ?? "instant");

    try {
      const service = this.host.environment.createResearchService(this.state.chatSettings);
      let completed = false;

      for await (const event of service.answer({
        question: cleanedQuestion || request.question,
        forceSubAgent: forceSubAgent || undefined,
        mode,
        searchMode: this.state.chatSettings.searchMode,
        contextMode: this.state.chatSettings.contextMode ?? "include",
        contextPaths: request.contextPaths.length > 0 ? request.contextPaths : undefined,
        activeFilePath: request.activeFilePath,
        includeActiveFile: request.includeActiveFile,
        includeContextDiagnostics: request.includeContextDiagnostics,
        chatHistory: chatHistoryForPrompt(request.chatHistory),
        ...(this.host.environment.buildRegistryPromptView
          ? {
              conversationRegistry: this.host.environment.buildRegistryPromptView(
                this.state.sourceRegistry,
                cleanedQuestion || request.question,
              ),
            }
          : {}),
        finalizeAnswer: (answer: ResearchAnswer) => this.registerAnswerSources(answer, runId),
        signal: this.controller.signal,
      })) {
        if (this.isFenced(runId)) break;
        diagnostics.record(event);
        if (event.type === "complete" && event.answer.contextDiagnostics) {
          diagnostics.complete(event.answer.contextDiagnostics);
        }
        this.applyEvent(event, runId, request.modelLabel);
        if (event.type === "complete") completed = true;
      }

      return { outcome: completed ? "completed" : "interrupted" };
    } catch (error) {
      if (isAbortError(error)) return { outcome: "interrupted" };
      this.host.environment.logError?.(error);
      return { outcome: "failed", error };
    } finally {
      this.controller = null;
      this.diagnostics = null;
    }
  }

  /** Counts a flushed or coalesced presentation update against the active run. */
  recordRender(kind: "markdown" | "coalesced"): void {
    if (kind === "markdown") this.diagnostics?.recordMarkdownRender();
    else this.diagnostics?.recordCoalescedUpdate();
  }

  private registerAnswerSources(answer: ResearchAnswer, runId: string): ResearchAnswer {
    if (this.isFenced(runId)) return answer;
    const assistantMessage = this.state.messages
      .filter((message) => message.role === "assistant")
      .at(-1);
    const messageId = assistantMessage?.id ?? assistantMessage?.createdAt ?? answer.createdAt;
    const registered = registerConversationEvidence(
      this.state.sourceRegistry,
      answer.evidence ?? [],
      answer.createdAt,
    );
    const boundAnswer = bindAnswerToConversationRegistry(
      answer,
      registered.registry,
      registered.revisionIdByEvidenceId,
    );
    this.state.sourceRegistry = recordConversationCitationUsages(
      registered.registry,
      messageId,
      boundAnswer.answer,
    );
    return boundAnswer;
  }

  private applyEvent(event: ResearchStreamEvent, runId: string, modelLabel: string): void {
    if (this.isFenced(runId)) return;

    if (event.type === "status") {
      this.state.progressLabel = event.message;
      this.emit(runId, "progress");
      return;
    }

    if (event.type === "context") return;

    if (event.type === "delta") {
      this.state.messages = nextAssistantMessage(this.state.messages, event.content);
      this.emit(runId, "active-message");
      return;
    }

    if (event.type === "reasoning") {
      const withReasoning = nextAssistantReasoning(
        this.state.messages,
        event.segmentId,
        event.content,
      );
      this.state.messages = nextChainReasoningSegment(
        withReasoning,
        event.segmentId,
        event.content,
      );
      this.emit(runId, "active-message");
      return;
    }

    if (event.type === "tool-call-start") {
      this.state.messages = nextChainToolCallStart(
        this.state.messages,
        event.id,
        event.name,
        event.label,
        event.args,
        event.parentId,
        event.fetchTargets,
        event.searchSources,
      );
      this.emit(runId, "active-message");
      return;
    }

    if (event.type === "tool-call-end") {
      this.state.messages = nextChainToolCallEnd(
        this.state.messages,
        event.id,
        event.ok,
        event.resolvedLabel,
        event.resultSummary,
        event.resultJson,
        event.parentId,
      );
      this.emit(runId, "active-message");
      return;
    }

    if (event.type === "sub-agent-phase") {
      this.state.messages = nextChainSubAgentPhase(
        this.state.messages,
        event.parentId,
        event.phase,
      );
      this.emit(runId, "active-message");
      return;
    }

    if (event.type === "checkpoint-delta") {
      this.state.messages = nextAssistantCheckpoint(
        this.state.messages,
        event.checkpointId,
        event.round,
        event.content,
      );
      this.emit(runId, "active-message");
      return;
    }

    if (event.type === "checkpoint-complete") {
      this.state.messages = completeAssistantCheckpoint(this.state.messages, event.checkpointId);
      this.emit(runId, "active-message");
      return;
    }

    if (event.type === "checkpoint-promote") {
      this.state.messages = promoteAssistantCheckpoint(this.state.messages, event.checkpointId);
      this.emit(runId, "active-message");
      return;
    }

    if (event.type === "answer-reset") {
      this.state.messages = resetLastAssistantContent(this.state.messages);
      this.emit(runId, "messages");
      return;
    }

    const finalAnswer = event.answer;
    this.state.lastAnswer = finalAnswer;
    this.state.messages = finalizeLastAssistantReasoning(this.state.messages);
    this.state.messages = stampLastAssistantModel(this.state.messages, modelLabel);
    this.state.messages = attachAnswerDetailsToLastAssistantMessage(this.state.messages, {
      finalAnswer,
      ...finalAnswer,
      ...(finalAnswer.isFallback
        ? { isFallback: true as const, fallbackReason: finalAnswer.fallbackReason }
        : {}),
    });
    this.emit(runId, "answer");
    this.emit(runId, "messages");
  }

  private emit(runId: string, kind: ChatSessionChangeKind): void {
    if (this.isFenced(runId)) return;
    this.host.emit(this.state.sessionId, kind);
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
