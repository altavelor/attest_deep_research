import type { SavedChat, SavedChatSummary, SaveChatInput } from "@core/chat/savedChat";

export type { SavedChat, SavedChatSummary, SaveChatInput };

export interface ChatRepository {
  listChats(): Promise<SavedChatSummary[]>;
  loadChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameChat(id: string, title: string): Promise<SavedChat | null>;
  setChatFavorite(id: string, isFavorite: boolean): Promise<SavedChat | null>;
  deleteChat(id: string): Promise<void>;
}
