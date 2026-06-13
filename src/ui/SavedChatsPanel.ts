import { setIcon } from "obsidian";

import { SavedChatSummary } from "../chat/ChatStore";

export interface SavedChatsPanelOptions {
  savedChats: SavedChatSummary[];
  currentChatId: string | null;
  searchQuery: string;
  onSearchQueryChange(query: string): void;
  onOpenChat(id: string): void;
  onViewAll(anchorEl: HTMLElement): void;
}

export function renderSavedChatsEmptyState(
  containerEl: HTMLElement,
  options: Pick<SavedChatsPanelOptions, "savedChats" | "onOpenChat" | "onViewAll">,
): void {
  const empty = containerEl.createDiv({ cls: "ixplorer-chat__empty-state" });
  const header = empty.createDiv({ cls: "ixplorer-chat__empty-header" });
  header.createEl("h3", { text: "Saved chats" });
  header.createSpan({
    cls: "ixplorer-chat__empty-count",
    text: `${options.savedChats.length} saved`,
  });

  if (options.savedChats.length === 0) {
    empty.createDiv({
      cls: "ixplorer-chat__empty-note",
      text: "No saved chats yet.",
    });
    return;
  }

  const list = empty.createDiv({ cls: "ixplorer-chat__saved-list" });
  const visibleChats = options.savedChats.slice(0, 5);
  for (const chat of visibleChats) {
    renderSavedChatRow(list, chat, "ixplorer-chat__saved-item", options.onOpenChat);
  }

  const hiddenCount = options.savedChats.length - visibleChats.length;
  if (hiddenCount > 0) {
    const viewAll = list.createEl("button", {
      cls: "ixplorer-chat__saved-view-all",
      attr: { type: "button" },
    });
    viewAll.createSpan({ text: "View all" });
    viewAll.createSpan({ text: String(hiddenCount) });
    viewAll.addEventListener("click", () => options.onViewAll(viewAll));
  }
}

export function renderSavedChatsPopoverContent(
  containerEl: HTMLElement,
  options: SavedChatsPanelOptions,
): void {
  containerEl.empty();

  const searchRow = containerEl.createDiv({ cls: "ixplorer-chat__history-search" });
  setIcon(searchRow.createSpan({ cls: "ixplorer-chat__history-search-icon" }), "search");
  const searchInput = searchRow.createEl("input", {
    attr: {
      type: "search",
      placeholder: "Search saved chats",
      "aria-label": "Search saved chats",
    },
  });
  searchInput.value = options.searchQuery;
  searchInput.addEventListener("input", () => {
    options.onSearchQueryChange(searchInput.value);
    renderSavedChatsPopoverContent(containerEl, {
      ...options,
      searchQuery: searchInput.value,
    });
  });

  const header = containerEl.createDiv({ cls: "ixplorer-chat__history-header" });
  header.createSpan({ text: "Recent chats" });
  header.createSpan({ text: String(options.savedChats.length) });

  const list = containerEl.createDiv({ cls: "ixplorer-chat__history-list" });
  const filtered = filterSavedChatSummaries(options.savedChats, options.searchQuery);

  if (filtered.length === 0) {
    list.createDiv({
      cls: "ixplorer-chat__history-empty",
      text: options.savedChats.length === 0 ? "No saved chats yet." : "No matching chats.",
    });
    return;
  }

  for (const chat of filtered) {
    const item = renderSavedChatRow(
      list,
      chat,
      "ixplorer-chat__history-item",
      options.onOpenChat,
    );
    if (chat.id === options.currentChatId) {
      item.addClass("is-active");
    }
  }

  if (options.searchQuery) {
    window.setTimeout(() => {
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    }, 0);
  }
}

export function positionSavedChatsPopover(
  hostEl: HTMLElement,
  anchorEl: HTMLElement,
  popoverEl: HTMLElement,
): void {
  const anchorRect = anchorEl.getBoundingClientRect();
  const hostRect = hostEl.getBoundingClientRect();
  const popoverRect = popoverEl.getBoundingClientRect();
  const gap = 8;
  const left = Math.min(
    Math.max(anchorRect.right - hostRect.left - popoverRect.width, gap),
    Math.max(gap, hostRect.width - popoverRect.width - gap),
  );
  const top = anchorRect.bottom - hostRect.top + gap;

  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

function renderSavedChatRow(
  containerEl: HTMLElement,
  chat: SavedChatSummary,
  className: string,
  onOpenChat: (id: string) => void,
): HTMLButtonElement {
  const button = containerEl.createEl("button", {
    cls: className,
    attr: { type: "button" },
  });
  const title = button.createSpan({ cls: "ixplorer-chat__saved-title", text: chat.title });
  title.setAttr("title", chat.title);
  const meta = button.createSpan({ cls: "ixplorer-chat__saved-meta" });
  meta.createSpan({ text: formatMessageCount(chat.messageCount) });
  meta.createSpan({ text: formatRelativeTime(chat.updatedAt) });
  button.addEventListener("click", () => onOpenChat(chat.id));
  return button;
}

function filterSavedChatSummaries(
  savedChats: SavedChatSummary[],
  query: string,
): SavedChatSummary[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return savedChats;
  }

  return savedChats.filter((chat) => chat.title.toLowerCase().includes(normalizedQuery));
}

function formatMessageCount(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (minutes < 1) {
    return "now";
  }

  if (hours < 1) {
    return `${minutes}m`;
  }

  if (days < 1) {
    return `${hours}h`;
  }

  if (weeks < 1) {
    return `${days}d`;
  }

  return `${weeks}w`;
}
