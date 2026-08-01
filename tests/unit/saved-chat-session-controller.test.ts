import { SavedChatSessionController } from "@apps/obsidian/ui/chat/history/SavedChatSessionController";
import type { SaveChatInput, SavedChat, SavedChatSummary } from "@core/chat/savedChat";

describe("SavedChatSessionController", () => {
  it("persists the current snapshot with its saved identity and refreshes the list", async () => {
    const savedChats = [summary("chat-1")];
    const saveChat = vi.fn(async (input: SaveChatInput) => savedChat(input));
    const controller = createController({ saveChat, savedChats });

    await controller.saveCurrent();
    await controller.saveCurrent();

    expect(saveChat).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({ id: expect.anything() }),
    );
    expect(saveChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "chat-1", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(controller.savedChats).toEqual(savedChats);
  });

  it("saves the current chat before loading and exposes the loaded identity", async () => {
    const loaded = savedChat({ ...saveInput(), id: "chat-2" });
    const saveChat = vi.fn(async (input: SaveChatInput) => savedChat(input));
    const loadChat = vi.fn(async () => loaded);
    const controller = createController({ saveChat, loadChat });

    await expect(controller.load("chat-2")).resolves.toEqual(loaded);

    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(loadChat).toHaveBeenCalledWith("chat-2");
    expect(controller.currentChatId).toBe("chat-2");
  });

  it("clears the active chat id when its chat is deleted", async () => {
    const controller = createController({
      loadChat: async () => savedChat({ ...saveInput(), id: "chat-1" }),
    });
    await controller.load("chat-1");

    await expect(controller.delete("chat-1")).resolves.toBe(true);

    expect(controller.currentChatId).toBeNull();
    expect(controller.currentChatCreatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("updates favorite state and refreshes saved chat summaries", async () => {
    const setSavedChatFavorite = vi.fn(async () => undefined);
    const savedChats = [{ ...summary("chat-1"), isFavorite: true }];
    const controller = createController({ savedChats, setSavedChatFavorite });

    await controller.setFavorite("chat-1", true);

    expect(setSavedChatFavorite).toHaveBeenCalledWith("chat-1", true);
    expect(controller.savedChats).toEqual(savedChats);
  });
});

function createController(
  options: {
    saveChat?: (input: SaveChatInput) => Promise<SavedChat>;
    loadChat?: (id: string) => Promise<SavedChat | null>;
    savedChats?: SavedChatSummary[];
    setSavedChatFavorite?: (id: string, isFavorite: boolean) => Promise<void>;
  } = {},
): SavedChatSessionController {
  return new SavedChatSessionController({
    listSavedChats: async () => options.savedChats ?? [],
    loadSavedChat: options.loadChat ?? (async () => null),
    saveChat: options.saveChat ?? (async (input) => savedChat(input)),
    renameSavedChat: async () => undefined,
    setSavedChatFavorite: options.setSavedChatFavorite ?? (async () => undefined),
    deleteSavedChat: async () => undefined,
    createSaveInput: saveInput,
  });
}

function saveInput(): Omit<SaveChatInput, "id" | "createdAt"> {
  return {
    title: "Current chat",
    messages: [],
    lastAnswer: null,
    attachedContextPaths: [],
    chatSettings: {
      chatModelProfileId: "model",
      indexProfileId: "index",
      searchMode: "indexOnly",
    },
  };
}

function savedChat(input: SaveChatInput): SavedChat {
  return {
    ...input,
    schemaVersion: 2,
    id: input.id ?? "chat-1",
    title: input.title ?? "Current chat",
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

function summary(id: string): SavedChatSummary {
  return {
    id,
    title: "Current chat",
    updatedAt: "2026-01-02T00:00:00.000Z",
    messageCount: 0,
    isFavorite: false,
  };
}
