// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  positionSavedChatsPopover,
  renderSavedChatsEmptyState,
  renderSavedChatsPopoverContent,
} from "@apps/obsidian/ui/chat/history/SavedChatsPanel";
import type { SavedChatSummary } from "@core/chat/savedChat";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = ((key: string, values?: Record<string, unknown>) =>
  `${key}:${values?.count ?? ""}`) as never;
const chat = (id: string, title: string, favorite = false): SavedChatSummary => ({
  id,
  title,
  updatedAt: "2026-08-10T00:00:00.000Z",
  messageCount: 1,
  isFavorite: favorite,
  unreadCompletion: false,
});

describe("SavedChatsPanel", () => {
  beforeEach(() => installObsidianDomHelpers());
  afterEach(() => resetDom());

  it("shows an empty notice or a bounded list with a view-all action", () => {
    const empty = document.createElement("div");
    renderSavedChatsEmptyState(empty, {
      savedChats: [],
      t,
      onOpenChat: vi.fn(),
      onViewAll: vi.fn(),
    });
    expect(empty.querySelector(".attest-chat__empty-note")?.textContent).toContain("empty");

    const container = document.createElement("div");
    const onViewAll = vi.fn();
    renderSavedChatsEmptyState(container, {
      savedChats: Array.from({ length: 7 }, (_, i) => chat(String(i), `Chat ${i}`)),
      t,
      onOpenChat: vi.fn(),
      onViewAll,
    });
    expect(container.querySelectorAll(".attest-chat__saved-item")).toHaveLength(5);
    container.querySelector<HTMLButtonElement>(".attest-chat__saved-view-all")?.click();
    expect(onViewAll).toHaveBeenCalledOnce();
  });

  it("filters favorites, marks the current chat, and routes row actions", () => {
    const container = document.createElement("div");
    const onOpenChat = vi.fn();
    const onRenameChat = vi.fn();
    const onToggleFavorite = vi.fn();
    const onDeleteChat = vi.fn();
    renderSavedChatsPopoverContent(container, {
      savedChats: [chat("one", "Project notes", true), chat("two", "Other")],
      currentChatId: "one",
      searchQuery: "project",
      activeTab: "favorites",
      t,
      onSearchQueryChange: vi.fn(),
      onTabChange: vi.fn(),
      onOpenChat,
      onRenameChat,
      onToggleFavorite,
      onDeleteChat,
    });

    expect(container.querySelectorAll(".attest-chat__history-item")).toHaveLength(1);
    expect(container.querySelector(".is-active")).not.toBeNull();
    container.querySelector<HTMLButtonElement>(".attest-chat__saved-open")?.click();
    container.querySelector<HTMLButtonElement>(".is-favorite")?.click();
    const buttons = container.querySelectorAll<HTMLButtonElement>(".attest-chat__saved-action");
    buttons[1]?.click();
    const input = container.querySelector<HTMLInputElement>(".attest-chat__saved-title-input")!;
    input.value = "Renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    buttons[2]?.click();

    expect(onOpenChat).toHaveBeenCalledWith("one");
    expect(onToggleFavorite).toHaveBeenCalledWith("one");
    expect(onRenameChat).toHaveBeenCalledWith("one", "Renamed");
    expect(onDeleteChat).toHaveBeenCalledWith("one");
  });

  it("reports no matches after a search and restores an edit cancelled with Escape", () => {
    const container = document.createElement("div");
    const onSearchQueryChange = vi.fn();
    const onRenameChat = vi.fn();
    renderSavedChatsPopoverContent(container, {
      savedChats: [chat("one", "Project notes")],
      currentChatId: null,
      searchQuery: "",
      activeTab: "history",
      t,
      onSearchQueryChange,
      onTabChange: vi.fn(),
      onOpenChat: vi.fn(),
      onRenameChat,
    });

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "missing";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onSearchQueryChange).toHaveBeenCalledWith("missing");
    expect(container.querySelector(".attest-chat__history-empty")?.textContent).toContain(
      "noMatches",
    );

    renderSavedChatsPopoverContent(container, {
      savedChats: [chat("one", "Project notes")],
      currentChatId: null,
      searchQuery: "",
      activeTab: "history",
      t,
      onSearchQueryChange,
      onTabChange: vi.fn(),
      onOpenChat: vi.fn(),
      onRenameChat,
    });
    container.querySelectorAll<HTMLButtonElement>(".attest-chat__saved-action")[0]?.click();
    const input = container.querySelector<HTMLInputElement>(".attest-chat__saved-title-input")!;
    input.value = "Discarded";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onRenameChat).not.toHaveBeenCalled();
    expect(container.querySelector(".attest-chat__saved-title")?.textContent).toBe("Project notes");
  });

  it("creates the inline title editor in the panel's popout document", () => {
    const popoutDocument = document.implementation.createHTMLDocument("Popout");
    const container = popoutDocument.body.createDiv();
    renderSavedChatsPopoverContent(container, {
      savedChats: [chat("one", "Project notes")],
      currentChatId: null,
      searchQuery: "",
      activeTab: "history",
      t,
      onSearchQueryChange: vi.fn(),
      onTabChange: vi.fn(),
      onOpenChat: vi.fn(),
      onRenameChat: vi.fn(),
    });
    const globalCreateElement = vi.spyOn(document, "createElement").mockImplementation(() => {
      throw new Error("global document used");
    });

    try {
      container.querySelectorAll<HTMLButtonElement>(".attest-chat__saved-action")[0]?.click();
    } finally {
      globalCreateElement.mockRestore();
    }

    expect(container.querySelector(".attest-chat__saved-title-input")?.ownerDocument).toBe(
      popoutDocument,
    );
  });

  it("keeps the popover inside the host while positioning it below the anchor", () => {
    const host = document.createElement("div");
    const anchor = document.createElement("button");
    const popover = document.createElement("div");
    Object.assign(host, { getBoundingClientRect: () => ({ left: 100, top: 100, width: 200 }) });
    Object.assign(anchor, { getBoundingClientRect: () => ({ right: 140, bottom: 30 }) });
    Object.assign(popover, { getBoundingClientRect: () => ({ width: 180 }) });

    positionSavedChatsPopover(host, anchor, popover);

    expect(popover.style.left).toBe("8px");
    expect(popover.style.top).toBe("-62px");
  });
});
