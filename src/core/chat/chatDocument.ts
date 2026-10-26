import type { SubAgentStateSnapshot } from "@core/research/subAgent";
import type { SaveChatInput, SavedChat } from "./savedChat";

export type ChatStorageErrorCode =
  | "unreadable-section"
  | "invalid-snapshot"
  | "document-conflict"
  | "chat-missing"
  | "file-too-large";

export interface ChatFileBaseline {
  readonly content: string;
  readonly subAgents: string;
}

export interface ChatDocumentChange {
  chatId: string | null;
  base?: ChatFileBaseline;
  chat?: SaveChatInput;
  subAgents?: SubAgentStateSnapshot;
}

export interface ChatDocumentCommit {
  chat: SavedChat;
  base: ChatFileBaseline;
  subAgentRevision: number | null;
  written: boolean;
}

/** The only failure raised by chat document storage; its code tells callers how to recover. */
export class ChatStorageError extends Error {
  constructor(
    readonly code: ChatStorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChatStorageError";
  }
}

/** Narrows an unknown failure to a chat storage error. */
export function isChatStorageError(error: unknown): error is ChatStorageError {
  return error instanceof ChatStorageError;
}
