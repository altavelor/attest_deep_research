import {
  ChatStorageError,
  isChatStorageError,
  type ChatFileBaseline,
} from "@application/ports/chat";
import type { SubAgentDurableWriter } from "@application/ports/subAgent";
import type { SaveChatInput } from "@core/chat/savedChat";
import {
  checkSubAgentDelta,
  type SubAgentBufferedValue,
  type SubAgentFlushReason,
  type SubAgentStateSnapshot,
} from "@core/research";
import {
  assembleSection,
  carryUnsentRevisions,
  chatDocumentChange,
  chatMissing,
  deltaBytes,
  dropInapplicableDeltas,
  holdsWaiter,
  isNewWork,
  type PendingDelta,
} from "./chatWriteBatch";
import {
  DEFAULT_CHAT_WRITE_LIMITS,
  type ChatWriteBufferLimits,
  type ChatSnapshotEntry,
  type ChatWriteBufferOptions,
  type ChatWriteWaiter,
} from "./chatWriteBufferTypes";

export type { ChatWriteBufferLimits, ChatWriteBufferOptions };

/**
 * The single writer of one chat file: it batches chat snapshots and validated
 * sub-agent deltas and commits them together through the chat repository. Timer,
 * count and size triggers respect a gap between saves while barriers flush at
 * once; an acknowledgement is given only after the batch holding that revision
 * is durable, and failures keep the buffered state.
 */
export class ChatWriteBuffer implements SubAgentDurableWriter {
  private readonly limits: ChatWriteBufferLimits;
  private readonly pending = new Map<string, PendingDelta>();
  private readonly keyRevisions = new Map<string, number>();
  private chat: ChatSnapshotEntry | null = null;
  private batchChat: ChatSnapshotEntry | null = null;
  private batchDeltas = new Set<PendingDelta>();
  private lastChat: SaveChatInput | null = null;
  private durable: SubAgentStateSnapshot | null;
  private baseline: ChatFileBaseline | null;
  private waiters: ChatWriteWaiter[] = [];
  private revision = 0;
  private staged = 0;
  private revisionFloor = 0;
  private updates = 0;
  private firstDirtyAt: number | null = null;
  private lastSaveAt = Number.NEGATIVE_INFINITY;
  private retryAt = Number.NEGATIVE_INFINITY;
  private retries = 0;
  private barrier = false;
  private inFlight: Promise<void> | null = null;
  private timer: { cancel(): void } | null = null;
  private conflict: ChatStorageError | null = null;
  private sectionBlocked: ChatStorageError | null = null;
  private sectionInvalid: ChatStorageError | null = null;
  private fenced = false;
  private disposed = false;
  private overGuard = false;

  constructor(private readonly options: ChatWriteBufferOptions) {
    this.limits = { ...DEFAULT_CHAT_WRITE_LIMITS, ...options.limits };
    this.durable = options.base;
    this.baseline = options.baseline;
    this.revision = options.base?.revision ?? 0;
  }

  markChatDirty(input: SaveChatInput): number {
    this.assertOpen();
    this.revision += 1;
    const unsent = this.chat && this.chat !== this.batchChat ? this.chat.revision : null;
    this.chat = { input, revision: unsent ?? this.revision };
    this.lastChat = input;
    this.touch();
    return this.revision;
  }

  markDirty(key: string, revision: number, payload: SubAgentBufferedValue): "accepted" | "full" {
    this.assertOpen();
    if (this.options.getChatId() === null) {
      throw new Error("Sub-agent state cannot be buffered before the chat has a durable id.");
    }
    const problem = checkSubAgentDelta(payload);
    if (problem) throw new Error(problem);
    const known = this.keyRevisions.get(key);
    if (known !== undefined && known > revision) return "accepted";
    if (this.overGuard && known === undefined && isNewWork(payload)) {
      throw new ChatStorageError(
        "file-too-large",
        "This chat file is too large for new sub-agent work; start a new chat.",
      );
    }
    const bytes = deltaBytes(payload);
    const previous = this.pending.get(key);
    if (this.pendingBytes() - (previous?.bytes ?? 0) + bytes > this.limits.maxPendingBytes) {
      return "full";
    }
    const carried = previous && !this.batchDeltas.has(previous) ? previous : null;
    const firstRevision = Math.min(carried?.firstRevision ?? revision, revision);
    this.staged += 1;
    const firstStaged = carried?.firstStaged ?? this.staged;
    this.pending.set(key, { revision, firstRevision, firstStaged, value: payload, bytes });
    this.keyRevisions.set(key, revision);
    this.sectionInvalid = null;
    this.revision = Math.max(this.revision, revision);
    this.updates += 1;
    this.touch();
    return "accepted";
  }

  flushThrough(revision: number, reason: SubAgentFlushReason): Promise<void> {
    if (this.fenced) return Promise.reject(chatMissing());
    const staged = this.staged;
    if (this.isDurable(revision, staged)) return Promise.resolve();
    if (this.disposed) return Promise.reject(new Error("The chat write buffer is disposed."));
    if (reason === "barrier" || reason === "dispose") {
      if (this.conflict) return Promise.reject(this.conflict);
      this.barrier = true;
    }
    const promise = new Promise<void>((resolve, reject) => {
      this.waiters.push({ revision, staged, resolve, reject });
    });
    this.plan();
    return promise;
  }

  /** Fences the buffer for deletion: later writes are refused and waiting flushes fail with chat-missing. */
  async discard(): Promise<void> {
    this.fenced = true;
    this.cancelTimer();
    await this.inFlight;
    this.rejectWaiters(chatMissing());
  }

  reopen(): void {
    this.fenced = false;
    this.plan();
  }

  async resolveConflict(choice: "reload" | "keep"): Promise<void> {
    const chatId = this.options.getChatId();
    await this.inFlight;
    const loaded = chatId === null ? null : await this.options.repository.loadChatDocument(chatId);
    if (!loaded) throw chatMissing();
    this.baseline = loaded.base;
    const section = loaded.chat.subAgents;
    if (choice === "keep") {
      if (section?.status === "ready") this.revisionFloor = section.snapshot.revision;
    } else {
      this.chat = null;
      this.durable = section?.status === "ready" ? section.snapshot : null;
      const dropped = dropInapplicableDeltas(this.pending, this.durable, chatId!);
      if (dropped > 0) {
        this.report(
          new ChatStorageError(
            "document-conflict",
            `${dropped} sub-agent updates no longer apply to the reloaded chat and were discarded.`,
          ),
        );
      }
    }
    this.conflict = null;
    this.settleWaiters();
    this.plan();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.cancelTimer();
    if (!this.fenced && !this.conflict && this.isDirty()) {
      this.barrier = true;
      await this.commit().catch(() => undefined);
    }
    await this.inFlight;
    this.disposed = true;
    this.cancelTimer();
    this.rejectWaiters(new Error("The chat write buffer is disposed."));
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error("The chat write buffer is disposed.");
    if (this.fenced) throw chatMissing();
  }

  private touch(): void {
    this.firstDirtyAt ??= this.nowMs();
    this.plan();
  }

  private plan(): void {
    this.cancelTimer();
    if (this.inFlight || this.fenced || this.disposed || !this.isDirty()) return;
    if (this.barrier) {
      void this.commit();
      return;
    }
    if (this.conflict) return;
    const sizeDue =
      this.updates >= this.limits.maxUpdates || this.pendingBytes() >= this.limits.maxBatchBytes;
    const dueAt = Math.max(
      sizeDue ? this.nowMs() : (this.firstDirtyAt ?? this.nowMs()) + this.limits.flushDelayMs,
      this.lastSaveAt + this.limits.saveGapMs,
      this.retryAt,
    );
    this.timer = this.options.scheduleTimeout(
      () => void this.commit(),
      Math.max(0, dueAt - this.nowMs()),
    );
  }

  private commit(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.cancelTimer();
    this.barrier = false;
    this.updates = 0;
    this.firstDirtyAt = null;
    this.inFlight = this.runBatch().finally(() => {
      this.inFlight = null;
      this.lastSaveAt = this.nowMs();
      if (this.isDirty()) this.firstDirtyAt ??= this.nowMs();
      this.settleWaiters();
      this.plan();
    });
    return this.inFlight;
  }

  private async runBatch(): Promise<void> {
    const chatId = this.options.getChatId();
    if (chatId !== null && this.baseline === null) {
      try {
        await this.adoptStoredDocument(chatId);
      } catch (error) {
        await this.handleFailure(error as Error, chatId, this.chat, false);
        return;
      }
      if (this.fenced) return;
    }
    const chat = this.chat;
    const deltas = new Map(this.pending);
    this.batchChat = chat;
    this.batchDeltas = new Set(deltas.values());
    const section =
      deltas.size > 0 && chatId !== null && !this.sectionError()
        ? assembleSection(
            this.durable,
            chatId,
            [...deltas.values()],
            this.revisionFloor,
            this.lastChat,
            this.limits,
          )
        : null;
    if (section) this.overGuard = section.overGuard;
    if (section && !section.snapshot) {
      this.sectionInvalid = new ChatStorageError(
        "invalid-snapshot",
        "Sub-agent state was not saved: an update refers to a missing entry.",
      );
      this.report(this.sectionInvalid);
    }
    const subAgents = section?.snapshot ?? undefined;
    if (!chat && !subAgents) return;
    try {
      await this.write(chatId, chat, subAgents);
      for (const [key, delta] of deltas) {
        if (subAgents && this.pending.get(key) === delta) this.pending.delete(key);
      }
      if (subAgents) this.durable = subAgents;
      this.retries = 0;
      this.retryAt = Number.NEGATIVE_INFINITY;
    } catch (error) {
      carryUnsentRevisions(this.chat, this.pending, chat, deltas);
      await this.handleFailure(error as Error, chatId, chat, subAgents !== undefined);
    } finally {
      this.batchChat = null;
      this.batchDeltas = new Set();
    }
  }

  /** Takes the baseline and saved sub-agent section of a chat this buffer did not create. */
  private async adoptStoredDocument(chatId: string): Promise<void> {
    const loaded = await this.options.repository.loadChatDocument(chatId);
    if (!loaded) throw chatMissing();
    this.baseline = loaded.base;
    const section = loaded.chat.subAgents;
    if (this.durable === null && section?.status === "ready") this.durable = section.snapshot;
  }

  private async write(
    chatId: string | null,
    chat: ChatSnapshotEntry | null,
    subAgents: SubAgentStateSnapshot | undefined,
  ): Promise<void> {
    const commit = await this.options.repository.commitChatDocument(
      chatDocumentChange(chatId, this.baseline, chat, subAgents),
    );
    this.baseline = commit.base;
    if (this.chat === chat) this.chat = null;
    if (chatId === null) this.options.onChatBound(commit.chat.id);
  }

  private async handleFailure(
    error: Error,
    chatId: string | null,
    chat: ChatSnapshotEntry | null,
    hadSection: boolean,
  ): Promise<void> {
    this.report(error);
    const code = isChatStorageError(error) ? error.code : null;
    if (chatId === null) {
      if (this.chat === chat) this.chat = null;
    } else if (code === "document-conflict") {
      this.conflict = error as ChatStorageError;
    } else if (hadSection && (code === "unreadable-section" || code === "invalid-snapshot")) {
      if (code === "unreadable-section") this.sectionBlocked = error as ChatStorageError;
      else this.sectionInvalid = error as ChatStorageError;
      await this.writeChatOnly(chatId, chat);
    } else if (code === "chat-missing") {
      this.fenced = true;
    } else {
      this.retries += 1;
      const delay = Math.min(
        this.limits.saveGapMs * 2 ** (this.retries - 1),
        this.limits.retryMaxMs,
      );
      this.retryAt = this.nowMs() + delay;
    }
    this.rejectWaiters(error, chatId !== null);
  }

  private async writeChatOnly(chatId: string, chat: ChatSnapshotEntry | null): Promise<void> {
    if (!chat) return;
    try {
      await this.write(chatId, chat, undefined);
    } catch (error) {
      this.report(error as Error);
    }
  }

  private sectionError(): ChatStorageError | null {
    return this.sectionBlocked ?? this.sectionInvalid;
  }

  private isDirty(): boolean {
    return this.chat !== null || (this.pending.size > 0 && !this.sectionError());
  }

  /** Tells whether the chat and every delta staged before the request up to a revision are durable. */
  private isDurable(revision: number, staged: number): boolean {
    if (this.chat && this.chat.revision <= revision) return false;
    return ![...this.pending.values()].some((delta) => holdsWaiter(delta, revision, staged));
  }

  private settleWaiters(): void {
    const open: ChatWriteWaiter[] = [];
    for (const waiter of this.waiters) {
      if (this.isDurable(waiter.revision, waiter.staged)) waiter.resolve();
      else if (this.sectionError()) waiter.reject(this.sectionError()!);
      else open.push(waiter);
    }
    this.waiters = open;
  }

  private rejectWaiters(error: Error, keepDurable = false): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      if (keepDurable && this.isDurable(waiter.revision, waiter.staged)) waiter.resolve();
      else waiter.reject(error);
    }
  }

  private pendingBytes(): number {
    return [...this.pending.values()].reduce((total, delta) => total + delta.bytes, 0);
  }

  private report(error: Error): void {
    this.options.onStorageError?.(error);
  }

  private cancelTimer(): void {
    this.timer?.cancel();
    this.timer = null;
  }

  private nowMs(): number {
    return this.options.now().getTime();
  }
}
