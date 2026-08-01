import { setIcon } from "obsidian";

import { SavedChatSummary } from "@core/chat/savedChat";
import {
  filterSavedChatsByTab,
  SavedChatListTab,
  shouldScrollSavedChatsList,
} from "./savedChatListState";

export interface SavedChatRowActions {
  onRenameChat?(id: string, title: string): void | Promise<void>;
  onDeleteChat?(id: string): void | Promise<void>;
  onToggleFavorite?(id: string): void | Promise<void>;
}

export interface SavedChatsEmptyStateOptions extends SavedChatRowActions {
  savedChats: SavedChatSummary[];
  onOpenChat(id: string): void;
  onViewAll(anchorEl: HTMLElement): void;
}

export interface SavedChatsPanelOptions extends SavedChatRowActions {
  savedChats: SavedChatSummary[];
  currentChatId: string | null;
  searchQuery: string;
  activeTab: SavedChatListTab;
  onSearchQueryChange(query: string): void;
  onTabChange(tab: SavedChatListTab): void;
  onOpenChat(id: string): void;
}

export function renderSavedChatsEmptyState(
  containerEl: HTMLElement,
  options: SavedChatsEmptyStateOptions,
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
    renderSavedChatRow(list, chat, "ixplorer-chat__saved-item", options);
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

  const tabs = containerEl.createDiv({ cls: "ixplorer-chat__history-tabs" });
  renderSavedChatsTab(tabs, "history", "History", options);
  renderSavedChatsTab(tabs, "favorites", "Favorites", options);

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
  header.createSpan({ text: options.activeTab === "history" ? "Recent chats" : "Favorite chats" });
  const chatsInTab = filterSavedChatsByTab(options.savedChats, options.activeTab);
  header.createSpan({ text: String(chatsInTab.length) });

  const filtered = filterSavedChatSummaries(chatsInTab, options.searchQuery);
  const list = containerEl.createDiv({
    cls: `ixplorer-chat__history-list${shouldScrollSavedChatsList(filtered.length) ? " is-scrollable" : ""}`,
  });

  if (filtered.length === 0) {
    list.createDiv({
      cls: "ixplorer-chat__history-empty",
      text:
        chatsInTab.length === 0
          ? options.activeTab === "history"
            ? "No saved chats yet."
            : "No favorite chats yet."
          : "No matching chats.",
    });
    return;
  }

  for (const chat of filtered) {
    const item = renderSavedChatRow(list, chat, "ixplorer-chat__history-item", options);
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

function renderSavedChatsTab(
  containerEl: HTMLElement,
  tab: SavedChatListTab,
  label: string,
  options: SavedChatsPanelOptions,
): void {
  const button = containerEl.createEl("button", {
    cls: `ixplorer-chat__history-tab${options.activeTab === tab ? " is-active" : ""}`,
    text: label,
    attr: {
      type: "button",
      "aria-pressed": String(options.activeTab === tab),
    },
  });
  button.addEventListener("click", () => options.onTabChange(tab));
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
  options: Pick<SavedChatsPanelOptions, "onOpenChat"> & SavedChatRowActions,
): HTMLElement {
  const row = containerEl.createDiv({ cls: `${className} ixplorer-chat__saved-row` });

  const button = row.createEl("button", {
    cls: "ixplorer-chat__saved-open",
    attr: { type: "button" },
  });
  const title = button.createSpan({ cls: "ixplorer-chat__saved-title", text: chat.title });
  title.setAttr("title", chat.title);
  const meta = button.createSpan({ cls: "ixplorer-chat__saved-meta" });
  meta.createSpan({ text: formatMessageCount(chat.messageCount) });
  meta.createSpan({ text: formatRelativeTime(chat.updatedAt) });
  button.addEventListener("click", () => options.onOpenChat(chat.id));

  if (options.onRenameChat || options.onDeleteChat || options.onToggleFavorite) {
    const actions = row.createDiv({
      cls: `ixplorer-chat__saved-actions${chat.isFavorite ? " has-favorite" : ""}`,
    });

    if (options.onToggleFavorite) {
      const isFavorite = chat.isFavorite === true;
      const favoriteButton = actions.createEl("button", {
        cls: `ixplorer-chat__saved-action${isFavorite ? " is-favorite" : ""}`,
        attr: {
          type: "button",
          "aria-label": isFavorite ? "Remove chat from favorites" : "Add chat to favorites",
          title: isFavorite ? "Remove from favorites" : "Add to favorites",
        },
      });
      setIcon(favoriteButton, "star");
      favoriteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void options.onToggleFavorite!(chat.id);
      });
    }

    if (options.onRenameChat) {
      const editButton = actions.createEl("button", {
        cls: "ixplorer-chat__saved-action",
        attr: { type: "button", "aria-label": "Rename chat", title: "Rename chat" },
      });
      setIcon(editButton, "pencil");
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        startInlineTitleEdit(button, title, chat, options.onRenameChat!);
      });
    }

    if (options.onDeleteChat) {
      const deleteButton = actions.createEl("button", {
        cls: "ixplorer-chat__saved-action ixplorer-chat__saved-action--delete",
        attr: { type: "button", "aria-label": "Delete chat", title: "Delete chat from disk" },
      });
      setIcon(deleteButton, "trash");
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void options.onDeleteChat!(chat.id);
      });
    }
  }

  return row;
}

function startInlineTitleEdit(
  openButton: HTMLButtonElement,
  titleEl: HTMLElement,
  chat: SavedChatSummary,
  onRenameChat: (id: string, title: string) => void | Promise<void>,
): void {
  if (openButton.querySelector("input")) {
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "ixplorer-chat__saved-title-input";
  input.value = chat.title;
  input.maxLength = 200;
  titleEl.replaceWith(input);

  let committed = false;
  const restore = () => {
    if (input.parentElement) {
      input.replaceWith(titleEl);
    }
  };
  const commit = () => {
    if (committed) {
      return;
    }
    committed = true;
    const nextTitle = input.value.trim();
    if (nextTitle && nextTitle !== chat.title) {
      titleEl.setText(nextTitle);
      titleEl.setAttr("title", nextTitle);
      void onRenameChat(chat.id, nextTitle);
    }
    restore();
  };

  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      committed = true;
      restore();
    }
  });
  input.addEventListener("blur", () => commit());

  input.focus();
  input.select();
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
