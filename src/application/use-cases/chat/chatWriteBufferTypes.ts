import type { ChatFileBaseline, ChatRepository } from "@application/ports/chat";
import type { SaveChatInput } from "@core/chat/savedChat";
import type { SubAgentStateSnapshot } from "@core/research";

export interface ChatWriteBufferLimits {
  detailsBudget: number;
  fileGuardChars: number;
  flushDelayMs: number;
  saveGapMs: number;
  maxUpdates: number;
  maxBatchBytes: number;
  maxPendingBytes: number;
  retryMaxMs: number;
}

export interface ChatWriteBufferOptions {
  repository: ChatRepository;
  getChatId(): string | null;
  onChatBound(id: string): void;
  base: SubAgentStateSnapshot | null;
  baseline: ChatFileBaseline | null;
  now(): Date;
  scheduleTimeout(callback: () => void, delayMs: number): { cancel(): void };
  limits?: Partial<ChatWriteBufferLimits>;
  onStorageError?(error: Error): void;
}

export interface ChatSnapshotEntry {
  input: SaveChatInput;
  revision: number;
}

export interface ChatWriteWaiter {
  revision: number;
  resolve(): void;
  reject(error: Error): void;
}

export const DEFAULT_CHAT_WRITE_LIMITS: ChatWriteBufferLimits = {
  detailsBudget: 2 * 1024 * 1024,
  fileGuardChars: 20 * 1024 * 1024,
  flushDelayMs: 500,
  saveGapMs: 2000,
  maxUpdates: 128,
  maxBatchBytes: 64 * 1024,
  maxPendingBytes: 256 * 1024,
  retryMaxMs: 30_000,
};
