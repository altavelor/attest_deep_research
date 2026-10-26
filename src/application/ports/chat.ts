import type { SavedChat, SavedChatSummary, SaveChatInput } from "@core/chat/savedChat";
import type { SavedChatRunState } from "@core/chat/chatSession";

import type {
  ChatDocumentChange,
  ChatDocumentCommit,
  ChatFileBaseline,
} from "@core/chat/chatDocument";

export type { SavedChat, SavedChatSummary, SaveChatInput };
export type { ChatDocumentChange, ChatDocumentCommit, ChatFileBaseline };
export {
  ChatStorageError,
  isChatStorageError,
  type ChatStorageErrorCode,
} from "@core/chat/chatDocument";

export interface ChatRepository {
  listChats(): Promise<SavedChatSummary[]>;
  loadChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameChat(id: string, title: string): Promise<SavedChat | null>;
  setChatFavorite(id: string, isFavorite: boolean): Promise<SavedChat | null>;
  setChatUnreadCompletion(id: string, unreadCompletion: boolean): Promise<SavedChat | null>;
  setChatRunState(id: string, lastRun: SavedChatRunState): Promise<SavedChat | null>;
  deleteChat(id: string): Promise<void>;
  loadChatDocument(id: string): Promise<{ chat: SavedChat; base: ChatFileBaseline } | null>;
  commitChatDocument(change: ChatDocumentChange): Promise<ChatDocumentCommit>;
}
