import { SavedChatSummary } from "@core/chat/savedChat";
import { positionSavedChatsPopover, renderSavedChatsPopoverContent } from "./SavedChatsPanel";
import { SavedChatListTab } from "./savedChatListState";

export interface SavedChatsPopoverControllerOptions {
  hostEl: HTMLElement;
  getSavedChats(): SavedChatSummary[];
  getCurrentChatId(): string | null;
  onOpenChat(id: string): void;
  onRenameChat(id: string, title: string): void;
  onToggleFavorite(id: string): void;
  onDeleteChat(id: string): void;
  refreshSavedChats(): Promise<void>;
}

/** Owns the saved-chat popover DOM and its outside-pointer lifecycle. */
export class SavedChatsPopoverController {
  private popoverEl: HTMLElement | null = null;
  private anchorEl: HTMLElement | null = null;
  private searchQuery = "";
  private activeTab: SavedChatListTab = "history";
  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node) || !this.popoverEl) return;
    if (!this.popoverEl.contains(target) && !this.anchorEl?.contains(target)) this.close();
  };

  constructor(private readonly options: SavedChatsPopoverControllerOptions) {}

  async toggle(anchorEl: HTMLElement): Promise<void> {
    if (this.popoverEl) {
      this.close();
      return;
    }
    await this.options.refreshSavedChats();
    this.anchorEl = anchorEl;
    this.popoverEl = this.options.hostEl.createDiv({ cls: "ixplorer-chat__history-popover" });
    this.render();
    positionSavedChatsPopover(this.options.hostEl, anchorEl, this.popoverEl);
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
  }

  render(): void {
    if (!this.popoverEl) {
      return;
    }
    renderSavedChatsPopoverContent(this.popoverEl, {
      savedChats: this.options.getSavedChats(),
      currentChatId: this.options.getCurrentChatId(),
      searchQuery: this.searchQuery,
      activeTab: this.activeTab,
      onSearchQueryChange: (query) => {
        this.searchQuery = query;
      },
      onTabChange: (tab) => {
        this.activeTab = tab;
        this.render();
      },
      onOpenChat: this.options.onOpenChat,
      onRenameChat: this.options.onRenameChat,
      onToggleFavorite: this.options.onToggleFavorite,
      onDeleteChat: this.options.onDeleteChat,
    });
  }

  isOpen(): boolean {
    return this.popoverEl !== null;
  }

  close(): void {
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    this.popoverEl?.remove();
    this.popoverEl = null;
    this.anchorEl = null;
  }
}
