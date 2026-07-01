// Chat persistence port (stage 1, task 6.1; neutralized in stage 5). The
// application depends on this abstraction, not on a concrete file store; swapping
// storage (SQLite/IndexedDB) means providing another adapter that implements it.
// DTOs now live in core/chat/savedChat, so this port is platform-neutral.

import type {
  SavedChat,
  SavedChatSummary,
  SaveChatInput,
} from "@core/chat/savedChat";

export type { SavedChat, SavedChatSummary, SaveChatInput };

export interface ChatRepository {
  listChats(): Promise<SavedChatSummary[]>;
  loadChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameChat(id: string, title: string): Promise<SavedChat | null>;
  deleteChat(id: string): Promise<void>;
}
