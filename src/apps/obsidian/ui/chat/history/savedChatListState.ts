export function shouldScrollSavedChatsList(visibleChatCount: number): boolean {
  return visibleChatCount > 15;
}
