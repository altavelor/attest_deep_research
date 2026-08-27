// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { positionSavedChatsPopover, renderSavedChatsPopoverContent } = vi.hoisted(() => ({
  positionSavedChatsPopover: vi.fn(),
  renderSavedChatsPopoverContent: vi.fn(),
}));

vi.mock("@apps/obsidian/ui/chat/history/SavedChatsPanel", () => ({
  positionSavedChatsPopover,
  renderSavedChatsPopoverContent,
}));

import { SavedChatsPopoverController } from "@apps/obsidian/ui/chat/history/SavedChatsPopoverController";

function controller() {
  const host = document.createElement("div");
  const refreshSavedChats = vi.fn().mockResolvedValue(undefined);
  const instance = new SavedChatsPopoverController({
    hostEl: Object.assign(host, {
      createDiv: (options: { cls: string }) => {
        const element = document.createElement("div");
        element.className = options.cls;
        host.append(element);
        return element;
      },
    }),
    getSavedChats: () => [],
    getCurrentChatId: () => null,
    t: ((key: string) => key) as never,
    onOpenChat: vi.fn(),
    onRenameChat: vi.fn(),
    onToggleFavorite: vi.fn(),
    onDeleteChat: vi.fn(),
    getChatStatus: () => "idle" as const,
    onStopChat: vi.fn(),
    refreshSavedChats,
  });
  return { instance, host, refreshSavedChats };
}

describe("SavedChatsPopoverController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes data before opening and closes on a repeated toggle", async () => {
    const state = controller();
    const anchor = document.createElement("button");

    await state.instance.toggle(anchor);

    expect(state.refreshSavedChats).toHaveBeenCalledOnce();
    expect(state.instance.isOpen()).toBe(true);
    expect(renderSavedChatsPopoverContent).toHaveBeenCalledOnce();
    expect(positionSavedChatsPopover).toHaveBeenCalledWith(
      state.host,
      anchor,
      expect.any(HTMLElement),
    );

    await state.instance.toggle(anchor);

    expect(state.instance.isOpen()).toBe(false);
    expect(state.host.children).toHaveLength(0);
  });

  it("closes when a pointer lands outside both the popover and its anchor", async () => {
    const state = controller();
    const anchor = document.body.appendChild(document.createElement("button"));
    const outside = document.body.appendChild(document.createElement("button"));
    try {
      await state.instance.toggle(anchor);
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));

      expect(state.instance.isOpen()).toBe(false);
    } finally {
      anchor.remove();
      outside.remove();
      state.instance.close();
    }
  });

  it("rerenders with the selected tab when panel interaction changes it", async () => {
    const state = controller();
    const anchor = document.createElement("button");

    await state.instance.toggle(anchor);
    const firstOptions = renderSavedChatsPopoverContent.mock.calls[0]?.[1] as {
      onTabChange(tab: "favorites"): void;
    };
    firstOptions.onTabChange("favorites");

    expect(renderSavedChatsPopoverContent).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ activeTab: "favorites" }),
    );
    state.instance.close();
  });
});
