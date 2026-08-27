import type { SavedChat, SavedChatSummary, SaveChatInput } from "@core/chat/savedChat";
import type { SavedChatRunState } from "@core/chat/chatSession";

export type { SavedChat, SavedChatSummary, SaveChatInput };

export interface ChatRepository {
  listChats(): Promise<SavedChatSummary[]>;
  loadChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameChat(id: string, title: string): Promise<SavedChat | null>;
  setChatFavorite(id: string, isFavorite: boolean): Promise<SavedChat | null>;
  setChatUnreadCompletion(id: string, unreadCompletion: boolean): Promise<SavedChat | null>;
  setChatRunState(id: string, lastRun: SavedChatRunState): Promise<SavedChat | null>;
  deleteChat(id: string): Promise<void>;
}
