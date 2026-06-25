// Chat persistence port (stage 1, task 6.1). The application depends on this
// abstraction, not on a concrete file store; swapping storage (SQLite/IndexedDB)
// means providing another adapter that implements this interface.
//
// NOTE: the saved-chat DTOs still live in chat/ChatStore during stage 1; this
// port re-exports them so callers have a single import site. Physically moving
// the DTOs to a neutral module and the fs implementation to adapters/filesystem
// is a follow-up.

import type {
  SavedChat,
  SavedChatSummary,
  SaveChatInput,
} from "../../chat/ChatStore";

export type { SavedChat, SavedChatSummary, SaveChatInput };

export interface ChatRepository {
  listChats(): Promise<SavedChatSummary[]>;
  loadChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameChat(id: string, title: string): Promise<SavedChat | null>;
  deleteChat(id: string): Promise<void>;
}
