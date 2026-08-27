import type { ChatRepository } from "@application/ports/chat";
import type { SaveChatInput, SavedChat, SavedChatSettings } from "@core/chat/savedChat";
import { inferChatTitle } from "@core/chat/savedChat";
import type { SavedChatSummary } from "@core/chat/savedChat";
import {
  chatHistoryActivity,
  isNonTerminalChatSessionStatus,
  nextRunStatus,
  normalizeStaleRunState,
  type ChatHistoryActivity,
  type ChatSessionStatus,
  type InterruptionReason,
  type SavedChatRunState,
} from "@core/chat/chatSession";
import {
  interruptLastAssistantProgress,
  nextAssistantMessage,
  nextUserMessage,
  startAssistantProgress,
  stripMessageDiagnostics,
} from "@core/conversation";
import { toUserMessage } from "@core/errors";
import type { ResearchAnswer } from "@core/answer";
import { ChatSessionRuntime } from "./ChatSessionRuntime";
import {
  createIdleSessionState,
  resolveRunMode,
  sessionStateFromSavedChat,
} from "./chatSessionSnapshots";
import type {
  ChatRunRequest,
  ChatSessionChangeKind,
  ChatSessionEnvironment,
  ChatSessionListener,
  ChatSessionState,
  ChatSessionViewProbe,
} from "./chatSessionTypes";

export interface ChatSessionManagerOptions {
  repository: ChatRepository;
  environment: ChatSessionEnvironment;
  persistDiagnostics(): boolean;
}

export type ChatRowStatusInput = Pick<SavedChatSummary, "id" | "unreadCompletion"> & {
  lastRun?: SavedChatRunState;
};

export interface ChatRunStartResult {
  started: boolean;
  error?: unknown;
}

/**
 * Plugin-owned registry of chat sessions. It persists run boundaries, enforces
 * the FIFO concurrency policy, routes stream events by session and run, and
 * survives every chat view being closed.
 */
export class ChatSessionManager {
  private readonly sessions = new Map<string, ChatSessionRuntime>();
  private readonly pending = new Map<string, { request: ChatRunRequest; runId: string }>();
  private readonly executions = new Map<string, Promise<void>>();
  private readonly listeners = new Set<ChatSessionListener>();
  private readonly slots = new Map<string, string>();
  private readonly starting = new Set<string>();
  private queue: string[] = [];
  private readonly views = new Set<ChatSessionViewProbe>();
  private lastDisplayedSessionId: string | null = null;
  private sequence = 0;
  private disposed = false;

  constructor(private readonly options: ChatSessionManagerOptions) {}

  subscribe(listener: ChatSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Registers a view and returns its detach function. The probe reports which
   * session that view is displaying, so selection stays owned by each view.
   */
  attachView(probe: ChatSessionViewProbe): () => void {
    this.views.add(probe);
    return () => {
      this.views.delete(probe);
    };
  }

  /** Records what a view is showing so a reopened tab resumes the same chat. */
  noteDisplayed(sessionId: string): void {
    this.lastDisplayedSessionId = sessionId;
  }

  get resumableSessionId(): string | null {
    const sessionId = this.lastDisplayedSessionId;
    return sessionId !== null && this.sessions.has(sessionId) ? sessionId : null;
  }

  listSessions(): ChatSessionState[] {
    return [...this.sessions.values()].map((runtime) => runtime.state);
  }

  getSession(sessionId: string): ChatSessionState | undefined {
    return this.sessions.get(sessionId)?.state;
  }

  getSessionByChatId(chatId: string): ChatSessionState | undefined {
    return this.listSessions().find((state) => state.chatId === chatId);
  }

  createSession(chatSettings: SavedChatSettings): ChatSessionState {
    this.sequence += 1;
    const sessionId = `session-${this.sequence}`;
    const state = createIdleSessionState(sessionId, chatSettings);
    this.sessions.set(sessionId, new ChatSessionRuntime(state, this.runtimeHost()));
    return state;
  }

  /** Returns the live session of a saved chat, creating one from disk if needed. */
  adoptChat(chat: SavedChat, chatSettings: SavedChatSettings): ChatSessionState {
    const existing = this.getSessionByChatId(chat.id);
    if (existing) return existing;
    this.sequence += 1;
    const sessionId = `session-${this.sequence}`;
    const state = sessionStateFromSavedChat(sessionId, chat, chatSettings);
    this.sessions.set(sessionId, new ChatSessionRuntime(state, this.runtimeHost()));
    return state;
  }

  /**
   * Drops an idle, never-persisted session so abandoned drafts do not pile up.
   * A session whose run-start save is still in flight is kept: it is about to
   * own a persisted chat and a live run.
   */
  discardSession(sessionId: string): void {
    const state = this.getSession(sessionId);
    if (!state || state.chatId !== null || isNonTerminalChatSessionStatus(state.status)) return;
    if (this.starting.has(sessionId)) return;
    this.sessions.delete(sessionId);
  }

  update(
    sessionId: string,
    patch: Partial<
      Pick<
        ChatSessionState,
        | "messages"
        | "lastAnswer"
        | "sourceRegistry"
        | "attachedContextPaths"
        | "chatSettings"
        | "draft"
      >
    >,
  ): void {
    const state = this.getSession(sessionId);
    if (!state) return;
    Object.assign(state, patch);
  }

  /** Persists everything except run lifecycle; never runs while a run is active. */
  async save(sessionId: string): Promise<void> {
    const state = this.getSession(sessionId);
    if (!state || state.messages.length === 0) return;
    if (isNonTerminalChatSessionStatus(state.status)) return;
    const saved = await this.options.repository.saveChat(this.saveInput(state));
    state.chatId = saved.id;
  }

  /** Records a presentation update against the run's diagnostics collector. */
  recordRender(sessionId: string, kind: "markdown" | "coalesced"): void {
    this.sessions.get(sessionId)?.recordRender(kind);
  }

  status(chatId: string): ChatSessionStatus {
    return this.getSessionByChatId(chatId)?.status ?? "idle";
  }

  /**
   * Status a chat-list row should display: the live session when there is one,
   * the persisted last run otherwise. A completed run stops being announced
   * once the reader has opened that chat.
   */
  rowStatus(chat: ChatRowStatusInput): ChatSessionStatus {
    const session = this.getSessionByChatId(chat.id);
    const status = session?.status ?? persistedStatus(chat.lastRun);
    if (status !== "completed") return status;
    return (session ? session.unreadCompletion : chat.unreadCompletion) ? "completed" : "idle";
  }

  /** Merges live session statuses over persisted summaries for the toolbar badges. */
  activity(summaries: readonly SavedChatSummary[]): ChatHistoryActivity {
    const entries = summaries.map((summary) => {
      const session = this.getSessionByChatId(summary.id);
      return {
        status: session?.status ?? persistedStatus(summary.lastRun),
        unreadCompletion: session ? session.unreadCompletion : summary.unreadCompletion,
      };
    });
    for (const state of this.listSessions()) {
      if (state.chatId && summaries.some((summary) => summary.id === state.chatId)) continue;
      entries.push({ status: state.status, unreadCompletion: state.unreadCompletion });
    }
    return chatHistoryActivity(entries);
  }

  canDeleteChat(chatId: string): boolean {
    return !isNonTerminalChatSessionStatus(this.status(chatId));
  }

  async deleteChat(chatId: string): Promise<void> {
    if (!this.canDeleteChat(chatId)) {
      throw new Error(`Chat ${chatId} is running and cannot be deleted.`);
    }
    const session = this.getSessionByChatId(chatId);
    if (session) this.sessions.delete(session.sessionId);
    await this.options.repository.deleteChat(chatId);
  }

  /** Clears the unread-completion marker of a chat the user is now looking at. */
  async markViewed(sessionId: string): Promise<void> {
    const state = this.getSession(sessionId);
    if (!state || !state.unreadCompletion) return;
    state.unreadCompletion = false;
    this.emit(sessionId, "status");
    if (state.chatId) {
      await this.options.repository.setChatUnreadCompletion(state.chatId, false);
    }
  }

  /**
   * Persists the run-start snapshot, then either queues the session or starts
   * consuming its stream. The model is never contacted before the repository
   * returns a durable chat id.
   */
  async start(sessionId: string, request: ChatRunRequest): Promise<ChatRunStartResult> {
    const runtime = this.sessions.get(sessionId);
    if (this.disposed || !runtime) return { started: false };
    const state = runtime.state;
    if (isNonTerminalChatSessionStatus(state.status) || this.starting.has(sessionId)) {
      return { started: false };
    }

    this.starting.add(sessionId);
    const runId = this.options.environment.createRunId();
    const startedAt = this.options.environment.now().toISOString();
    const status = this.queue.length > 0 ? "queued" : nextRunStatus(this.slots.size);
    if (status === "running") this.slots.set(sessionId, runId);
    const withQuestion = request.appendQuestion
      ? nextUserMessage(state.messages, request.question, request.contextPaths)
      : state.messages;
    const messages = startAssistantProgress(
      withQuestion,
      resolveRunMode(request.question, state.chatSettings),
    );

    try {
      const saved = await this.options.repository.saveChat({
        ...this.saveInput({ ...state, messages }),
        unreadCompletion: false,
        lastRun: { runId, startedAt, status },
      });
      state.chatId = saved.id;
    } catch (error) {
      this.starting.delete(sessionId);
      this.releaseSlot(sessionId, runId);
      this.options.environment.logError?.(error);
      this.emit(sessionId, "status");
      return { started: false, error };
    }

    this.starting.delete(sessionId);
    if (this.disposed || !this.sessions.has(sessionId)) {
      this.releaseSlot(sessionId, runId);
      return { started: false };
    }

    state.messages = messages;
    state.status = status;
    state.activeRunId = runId;
    state.startedAt = startedAt;
    state.completedAt = null;
    state.lastAnswer = null;
    state.progressLabel = null;
    state.unreadCompletion = false;
    state.interruptionReason = null;
    state.draft = "";
    this.pending.set(sessionId, { request, runId });
    this.emit(sessionId, "messages");
    this.emit(sessionId, "status");

    if (status === "queued") {
      this.queue.push(sessionId);
      return { started: true };
    }

    this.launch(sessionId);
    return { started: true };
  }

  /** Cancels one session only; repeated calls on the same session are ignored. */
  stop(sessionId: string): void {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    const state = runtime.state;
    if (state.status !== "queued" && state.status !== "running") return;

    const wasQueued = state.status === "queued";
    state.status = "stopping";
    state.interruptionReason = "user";
    if (state.activeRunId) runtime.fence(state.activeRunId);
    this.emit(sessionId, "status");

    if (wasQueued) {
      this.queue = this.queue.filter((queued) => queued !== sessionId);
      void this.finish(sessionId, { outcome: "interrupted" });
      return;
    }

    runtime.abort();
  }

  /**
   * Startup recovery. Converts persisted queued, running, or stopping runs into
   * interrupted ones with reason `crash-recovery`, preserving `updatedAt` so an
   * old chat does not jump to the top of history.
   */
  async normalizeStaleChats(): Promise<void> {
    const summaries = await this.options.repository.listChats();
    const completedAt = this.options.environment.now().toISOString();
    for (const summary of summaries) {
      if (!summary.lastRun || !isNonTerminalChatSessionStatus(summary.lastRun.status)) continue;
      const chat = await this.options.repository.loadChat(summary.id);
      if (!chat?.lastRun) continue;
      const lastRun = normalizeStaleRunState(chat.lastRun, completedAt);
      if (!lastRun) continue;
      await this.options.repository.saveChat({
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        messages: interruptLastAssistantProgress(chat.messages),
        lastAnswer: chat.lastAnswer,
        attachedContextPaths: chat.attachedContextPaths,
        chatSettings: chat.chatSettings,
        sourceRegistry: chat.sourceRegistry,
        unreadCompletion: chat.unreadCompletion,
        lastRun,
      });
    }
  }

  /**
   * Plugin unload. Synchronously rejects new work, fences and aborts every run,
   * and starts bounded best-effort persistence whose completion is not awaited
   * by Obsidian.
   */
  dispose(): Promise<void> {
    this.disposed = true;
    this.queue = [];
    const writes: Promise<unknown>[] = [];
    const completedAt = this.options.environment.now().toISOString();

    for (const runtime of this.sessions.values()) {
      const state = runtime.state;
      if (!isNonTerminalChatSessionStatus(state.status)) continue;
      const runId = state.activeRunId;
      if (runId) runtime.fence(runId);
      runtime.abort();
      state.status = "interrupted";
      state.interruptionReason = "plugin-unload";
      state.completedAt = completedAt;
      state.messages = interruptLastAssistantProgress(state.messages);
      state.activeRunId = null;
      if (state.chatId && runId) {
        writes.push(
          Promise.resolve(
            this.options.repository.saveChat({
              ...this.saveInput(state),
              lastRun: {
                runId,
                startedAt: state.startedAt ?? completedAt,
                completedAt,
                status: "interrupted",
                interruptionReason: "plugin-unload",
              },
            }),
          ).catch((error: unknown) => this.options.environment.logError?.(error)),
        );
      }
    }

    this.slots.clear();
    this.starting.clear();
    this.pending.clear();
    this.executions.clear();
    this.listeners.clear();
    this.sessions.clear();
    this.views.clear();
    this.lastDisplayedSessionId = null;
    return Promise.allSettled(writes).then(() => undefined);
  }

  private isDisplayed(sessionId: string): boolean {
    for (const probe of this.views) {
      if (probe() === sessionId) return true;
    }
    return false;
  }

  private launch(sessionId: string): void {
    const runtime = this.sessions.get(sessionId);
    const pending = this.pending.get(sessionId);
    if (!runtime || !pending) return;
    this.slots.set(sessionId, pending.runId);
    const execution = runtime
      .execute(pending.request, pending.runId)
      .then((result) => this.finish(sessionId, result))
      .catch((error: unknown) => {
        this.options.environment.logError?.(error);
      });
    this.executions.set(sessionId, execution);
  }

  private async finish(
    sessionId: string,
    result: { outcome: "completed" | "failed" | "interrupted"; error?: unknown },
  ): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    const state = runtime.state;
    const runId = state.activeRunId;
    if (runId) runtime.fence(runId);
    const completedAt = this.options.environment.now().toISOString();
    let failure: unknown;

    if (result.outcome === "completed") {
      state.status = "completed";
      state.unreadCompletion = !this.isDisplayed(sessionId);
    } else if (result.outcome === "failed") {
      state.status = "failed";
      failure = result.error;
      state.messages = nextAssistantMessage(
        interruptLastAssistantProgress(state.messages),
        toUserMessage(result.error),
      );
    } else {
      state.status = "interrupted";
      state.interruptionReason = state.interruptionReason ?? "user";
      state.messages = interruptLastAssistantProgress(state.messages);
    }

    state.completedAt = completedAt;
    state.activeRunId = null;
    state.progressLabel = null;
    this.pending.delete(sessionId);
    this.emit(sessionId, "messages");
    this.emit(sessionId, "status");

    if (runId) {
      try {
        await this.options.repository.saveChat({
          ...this.saveInput(state),
          unreadCompletion: state.unreadCompletion,
          lastRun: this.terminalRunState(state, runId, completedAt),
        });
      } catch (error) {
        this.options.environment.logError?.(error);
        failure = failure ?? error;
      }
    }

    if (failure !== undefined) this.emitError(sessionId, failure);
    this.releaseSlot(sessionId, runId);
  }

  private terminalRunState(
    state: ChatSessionState,
    runId: string,
    completedAt: string,
  ): SavedChatRunState {
    const base = { runId, startedAt: state.startedAt ?? completedAt, completedAt };
    if (state.status === "interrupted") {
      return {
        ...base,
        status: "interrupted",
        interruptionReason: (state.interruptionReason ?? "user") as InterruptionReason,
      };
    }
    return { ...base, status: state.status === "failed" ? "failed" : "completed" };
  }

  /**
   * Releases the slot of one run only. A slot already reserved by a newer run
   * of the same session is left alone, and only a released slot is handed to
   * the queue.
   */
  private releaseSlot(sessionId: string, runId: string | null): void {
    this.executions.delete(sessionId);
    if (runId === null || this.slots.get(sessionId) !== runId) return;
    this.slots.delete(sessionId);
    void this.promoteNext();
  }

  private async promoteNext(): Promise<void> {
    if (this.disposed) return;
    const sessionId = this.queue.shift();
    if (!sessionId) return;
    const runtime = this.sessions.get(sessionId);
    const pending = this.pending.get(sessionId);
    if (!runtime || !pending || runtime.state.status !== "queued") {
      void this.promoteNext();
      return;
    }

    runtime.state.status = "running";
    this.slots.set(sessionId, pending.runId);
    this.emit(sessionId, "status");
    if (runtime.state.chatId) {
      try {
        await this.options.repository.setChatRunState(runtime.state.chatId, {
          runId: pending.runId,
          startedAt: runtime.state.startedAt ?? this.options.environment.now().toISOString(),
          status: "running",
        });
      } catch (error) {
        this.options.environment.logError?.(error);
      }
    }
    if (this.disposed) return;
    if (runtime.state.status !== "running") {
      await this.finish(sessionId, { outcome: "interrupted" });
      return;
    }
    this.launch(sessionId);
  }

  private saveInput(state: ChatSessionState): SaveChatInput {
    const messages = this.options.persistDiagnostics()
      ? state.messages
      : stripMessageDiagnostics(state.messages);
    return {
      id: state.chatId ?? undefined,
      title: inferChatTitle(state.messages),
      messages,
      lastAnswer: this.options.persistDiagnostics()
        ? state.lastAnswer
        : stripAnswerContextDiagnostics(state.lastAnswer),
      attachedContextPaths: state.attachedContextPaths,
      chatSettings: state.chatSettings,
      sourceRegistry: state.sourceRegistry,
    };
  }

  private runtimeHost() {
    return {
      environment: this.options.environment,
      emit: (sessionId: string, kind: ChatSessionChangeKind) => this.emit(sessionId, kind),
    };
  }

  private emit(sessionId: string, kind: ChatSessionChangeKind): void {
    const chatId = this.getSession(sessionId)?.chatId ?? null;
    for (const listener of [...this.listeners]) {
      listener({ sessionId, chatId, kind });
    }
  }

  /** Surfaces a run or persistence failure to whichever views are attached. */
  private emitError(sessionId: string, error: unknown): void {
    const chatId = this.getSession(sessionId)?.chatId ?? null;
    for (const listener of [...this.listeners]) {
      listener({ sessionId, chatId, kind: "error", error });
    }
  }
}

function stripAnswerContextDiagnostics(answer: ResearchAnswer | null): ResearchAnswer | null {
  if (!answer?.contextDiagnostics) return answer;
  const { contextDiagnostics: _contextDiagnostics, ...rest } = answer;
  return rest;
}

function persistedStatus(lastRun: SavedChatRunState | undefined): ChatSessionStatus {
  if (!lastRun) return "idle";
  return isNonTerminalChatSessionStatus(lastRun.status) ? "interrupted" : lastRun.status;
}
