import { SavedChatSummary } from "@core/chat/savedChat";

export type SavedChatListTab = "history" | "favorites";

export function shouldScrollSavedChatsList(visibleChatCount: number): boolean {
  return visibleChatCount > 15;
}

export function filterSavedChatsByTab(
  savedChats: SavedChatSummary[],
  tab: SavedChatListTab,
): SavedChatSummary[] {
  return tab === "favorites" ? savedChats.filter((chat) => chat.isFavorite) : savedChats;
}
