import {
  ChatStorageError,
  isChatStorageError,
  type ChatDocumentChange,
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
  deltaBytes,
  dropInapplicableDeltas,
  type PendingDelta,
} from "./chatWriteBatch";
import {
  DEFAULT_CHAT_WRITE_LIMITS,
  type ChatWriteBufferLimits,
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
  private chat: { input: SaveChatInput; revision: number } | null = null;
  private batchChat: { input: SaveChatInput; revision: number } | null = null;
  private batchDeltas = new Set<PendingDelta>();
  private lastChat: SaveChatInput | null = null;
  private durable: SubAgentStateSnapshot | null;
  private baseline: ChatFileBaseline | null;
  private waiters: ChatWriteWaiter[] = [];
  private revision = 0;
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
    const unsent = previous && !this.batchDeltas.has(previous) ? previous.firstRevision : revision;
    const firstRevision = Math.min(unsent, revision);
    this.pending.set(key, { revision, firstRevision, value: payload, bytes });
    this.keyRevisions.set(key, revision);
    this.sectionInvalid = null;
    this.revision = Math.max(this.revision, revision);
    this.updates += 1;
    this.touch();
    return "accepted";
  }

  flushThrough(revision: number, reason: SubAgentFlushReason): Promise<void> {
    if (this.fenced) return Promise.reject(chatMissing());
    if (this.isDurable(revision)) return Promise.resolve();
    if (this.disposed) return Promise.reject(new Error("The chat write buffer is disposed."));
    if (reason === "barrier" || reason === "dispose") {
      if (this.conflict) return Promise.reject(this.conflict);
      this.barrier = true;
    }
    const promise = new Promise<void>((resolve, reject) => {
      this.waiters.push({ revision, resolve, reject });
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
      this.carryUnsentRevisions(chat, deltas);
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
    chat: { input: SaveChatInput; revision: number } | null,
    subAgents: SubAgentStateSnapshot | undefined,
  ): Promise<void> {
    const change: ChatDocumentChange =
      chatId === null
        ? { chatId: null, chat: chat!.input }
        : {
            chatId,
            ...(this.baseline ? { base: this.baseline } : {}),
            ...(chat ? { chat: chat.input } : {}),
            ...(subAgents ? { subAgents } : {}),
          };
    const commit = await this.options.repository.commitChatDocument(change);
    this.baseline = commit.base;
    if (this.chat === chat) this.chat = null;
    if (chatId === null) this.options.onChatBound(commit.chat.id);
  }

  private async handleFailure(
    error: Error,
    chatId: string | null,
    chat: { input: SaveChatInput; revision: number } | null,
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

  /** Keeps the oldest unacknowledged revision on entries that replaced a failed in-flight value. */
  private carryUnsentRevisions(
    chat: { input: SaveChatInput; revision: number } | null,
    deltas: ReadonlyMap<string, PendingDelta>,
  ): void {
    if (chat && this.chat && this.chat !== chat) {
      this.chat.revision = Math.min(this.chat.revision, chat.revision);
    }
    for (const [key, sent] of deltas) {
      const current = this.pending.get(key);
      if (current && current !== sent) {
        current.firstRevision = Math.min(current.firstRevision, sent.firstRevision);
      }
    }
  }

  private async writeChatOnly(
    chatId: string,
    chat: { input: SaveChatInput; revision: number } | null,
  ): Promise<void> {
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

  private isDurable(revision: number): boolean {
    if (this.chat && this.chat.revision <= revision) return false;
    for (const delta of this.pending.values()) {
      if (delta.firstRevision <= revision) return false;
    }
    return true;
  }

  private settleWaiters(): void {
    const open: ChatWriteWaiter[] = [];
    for (const waiter of this.waiters) {
      if (this.isDurable(waiter.revision)) waiter.resolve();
      else if (this.sectionError()) waiter.reject(this.sectionError()!);
      else open.push(waiter);
    }
    this.waiters = open;
  }

  private rejectWaiters(error: Error, keepDurable = false): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      if (keepDurable && this.isDurable(waiter.revision)) waiter.resolve();
      else waiter.reject(error);
    }
  }

  private pendingBytes(): number {
    let total = 0;
    for (const delta of this.pending.values()) total += delta.bytes;
    return total;
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

function isNewWork(payload: SubAgentBufferedValue): boolean {
  return payload.op === "set" && (payload.entity === "create" || payload.entity === "run");
}

function chatMissing(): ChatStorageError {
  return new ChatStorageError(
    "chat-missing",
    "The chat was deleted; nothing more is saved for it.",
  );
}
