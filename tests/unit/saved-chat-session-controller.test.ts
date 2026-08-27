import { describe, expect, it, vi } from "vitest";

import { SavedChatSessionController } from "@apps/obsidian/ui/chat/history/SavedChatSessionController";
import type { SavedChat, SavedChatSummary } from "@core/chat/savedChat";

const summary: SavedChatSummary = {
  id: "chat-1",
  title: "Saved chat",
  updatedAt: "2026-01-01T00:00:00.000Z",
  messageCount: 2,
  isFavorite: false,
  unreadCompletion: false,
};

const savedChat: SavedChat = {
  schemaVersion: 4,
  id: summary.id,
  title: summary.title,
  createdAt: summary.updatedAt,
  updatedAt: summary.updatedAt,
  messages: [],
  lastAnswer: null,
  attachedContextPaths: [],
  chatSettings: { chatModelProfileId: "model", searchMode: "indexOnly" },
  sourceRegistry: { sources: [] },
  unreadCompletion: false,
};

function createController(overrides: Partial<Record<string, unknown>> = {}) {
  const listSavedChats = vi.fn(async () => [summary]);
  const loadSavedChat = vi.fn(async () => savedChat);
  const renameSavedChat = vi.fn(async () => {});
  const setSavedChatFavorite = vi.fn(async () => {});
  const controller = new SavedChatSessionController({
    listSavedChats,
    loadSavedChat,
    renameSavedChat,
    setSavedChatFavorite,
    ...overrides,
  });
  return {
    controller,
    listSavedChats,
    loadSavedChat,
    renameSavedChat,
    setSavedChatFavorite,
  };
}

describe("SavedChatSessionController", () => {
  it("exposes the summaries it last refreshed", async () => {
    const harness = createController();

    expect(harness.controller.savedChats).toEqual([]);
    await harness.controller.refresh();

    expect(harness.controller.savedChats).toEqual([summary]);
  });

  it("loads a chat without writing anything first", async () => {
    const harness = createController();

    const chat = await harness.controller.load(summary.id);

    expect(chat).toBe(savedChat);
    expect(harness.loadSavedChat).toHaveBeenCalledWith(summary.id);
  });

  it("refreshes the list after a rename and a favorite change", async () => {
    const harness = createController();

    await harness.controller.rename(summary.id, "Renamed");
    await harness.controller.setFavorite(summary.id, true);

    expect(harness.renameSavedChat).toHaveBeenCalledWith(summary.id, "Renamed");
    expect(harness.setSavedChatFavorite).toHaveBeenCalledWith(summary.id, true);
    expect(harness.listSavedChats).toHaveBeenCalledTimes(2);
  });
});
