// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, ItemView, WorkspaceLeaf } from "../../stubs/obsidian";
import type { Plugin as StubPlugin } from "../../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";

import AttestPlugin from "@apps/obsidian/main";
import { ATTEST_CHAT_VIEW_TYPE } from "@apps/obsidian/ui/chat/AttestChatView";
import { createContainer, resetDom, restoreDomTimers } from "../../helpers/domHarness";

const FOREIGN_VIEW_TYPE = "foreign-view";

/** Non-chat view that re-renders on `redisplay`, so a broken leaf filter is observable. */
class ForeignView extends ItemView {
  getViewType(): string {
    return FOREIGN_VIEW_TYPE;
  }

  redisplay(): void {
    this.contentEl.empty();
  }
}

function createPlugin(app: App): AttestPlugin {
  return new AttestPlugin(app as unknown as ObsidianApp, {
    id: "attest",
    name: "Attest",
    version: "0.0.0",
    minAppVersion: "1.0.0",
    author: "test",
    description: "test",
  });
}

function asStubPlugin(plugin: AttestPlugin): StubPlugin {
  return plugin as unknown as StubPlugin;
}

function markerOf(view: { contentEl: HTMLElement }, name: string): HTMLElement {
  return view.contentEl.createDiv({ cls: name });
}

async function openChatLeaf(app: App): Promise<WorkspaceLeaf> {
  const leaf = app.workspace.createLeaf();
  await leaf.setViewState({ type: ATTEST_CHAT_VIEW_TYPE, active: true });
  return leaf;
}

describe("Attest plugin lifecycle", () => {
  let app: App;
  let plugin: AttestPlugin;

  beforeEach(async () => {
    createContainer();
    app = new App();
    plugin = createPlugin(app);
    await plugin.onload();
  });

  afterEach(async () => {
    plugin.unload();
    restoreDomTimers();
    resetDom();
  });

  it("redisplays only the open chat leaves", async () => {
    const chatLeaf = await openChatLeaf(app);
    const closedLeaf = await openChatLeaf(app);
    const closedView = closedLeaf.view as unknown as { contentEl: HTMLElement };
    app.workspace.registerViewFactory(FOREIGN_VIEW_TYPE, (leaf) => new ForeignView(leaf));
    const foreignLeaf = app.workspace.createLeaf();
    await foreignLeaf.setViewState({ type: FOREIGN_VIEW_TYPE, active: true });

    await closedLeaf.detach();
    const openView = chatLeaf.view as unknown as { contentEl: HTMLElement };
    const foreignView = foreignLeaf.view as unknown as { contentEl: HTMLElement };
    const openMarker = markerOf(openView, "open");
    const closedMarker = markerOf(closedView, "closed");
    const foreignMarker = markerOf(foreignView, "foreign");

    plugin.refreshChatViews();

    expect(openView.contentEl.contains(openMarker)).toBe(false);
    expect(closedView.contentEl.contains(closedMarker)).toBe(true);
    expect(foreignView.contentEl.contains(foreignMarker)).toBe(true);
  });

  it("keeps the chat view usable across repeated redisplays", async () => {
    const leaf = await openChatLeaf(app);

    plugin.refreshChatViews();
    plugin.refreshChatViews();

    const view = leaf.view as unknown as { contentEl: HTMLElement };
    expect(view.contentEl.querySelectorAll(".attest-chat").length).toBe(1);
  });

  it("replaces the chat command when the interface language changes", () => {
    plugin.settings.uiLanguage = "ru";

    plugin.applyUiLanguage();

    expect(asStubPlugin(plugin).commands).toEqual([
      expect.objectContaining({ id: "open-attest-chat", name: "Открыть чат Attest" }),
    ]);
  });

  it("marks the resolved index profile stale when no default index is configured", () => {
    const markStale = vi.spyOn(plugin.indexing, "markStale");
    expect(plugin.settings.newChatDefaults.indexProfileId).toBe("");

    plugin.markIndexStale();

    expect(markStale).toHaveBeenCalledWith(plugin.settings.indexProfiles[0].id);
  });

  it("opens the existing chat leaf when the chat command is activated again", async () => {
    const chatLeaf = await openChatLeaf(app);

    await plugin.activateChatView();

    expect(app.workspace.revealedLeaves).toEqual([chatLeaf]);
    expect(app.workspace.getLeavesOfType(ATTEST_CHAT_VIEW_TYPE)).toEqual([chatLeaf]);
  });

  it("creates and reveals a chat leaf when no chat is open", async () => {
    await plugin.activateChatView();

    const [chatLeaf] = app.workspace.getLeavesOfType(ATTEST_CHAT_VIEW_TYPE);
    expect(chatLeaf?.view?.getViewType()).toBe(ATTEST_CHAT_VIEW_TYPE);
    expect(app.workspace.revealedLeaves).toEqual([chatLeaf]);
  });

  it("opens a chat and warms index data when its embedding profile is configured", async () => {
    plugin.settings.serverProfiles = [
      {
        id: "server",
        name: "Server",
        apiFormat: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    plugin.settings.embeddingModelProfiles = [
      {
        id: "embedding",
        name: "Embedding",
        serverProfileId: "server",
        modelName: "embed-model",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    plugin.settings.indexProfiles[0] = {
      ...plugin.settings.indexProfiles[0],
      embeddingModelProfileId: "embedding",
      isSuspended: false,
      suspendedReason: undefined,
    };

    await plugin.activateChatView();

    expect(app.workspace.getLeavesOfType(ATTEST_CHAT_VIEW_TYPE)).toHaveLength(1);
    expect(app.workspace.revealedLeaves).toHaveLength(1);
  });

  it("opens the plugin settings tab when a chat notice requests it", () => {
    const open = vi.fn();
    const openTabById = vi.fn();
    (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting = {
      open,
      openTabById,
    };

    plugin.openSettingsTab();

    expect(open).toHaveBeenCalledOnce();
    expect(openTabById).toHaveBeenCalledWith("attest");
  });

  it("releases the view type, command and settings tab registered on load", async () => {
    expect(app.workspace.getViewFactory(ATTEST_CHAT_VIEW_TYPE)).toBeDefined();
    expect(asStubPlugin(plugin).commands.map((command) => command.id)).toContain(
      "open-attest-chat",
    );
    expect(asStubPlugin(plugin).settingTabs).toHaveLength(1);

    plugin.unload();

    expect(app.workspace.getViewFactory(ATTEST_CHAT_VIEW_TYPE)).toBeUndefined();
    expect(asStubPlugin(plugin).commands).toHaveLength(0);
    expect(asStubPlugin(plugin).settingTabs).toHaveLength(0);
    expect(asStubPlugin(plugin).registrationCount()).toBe(0);
    await expect(openChatLeaf(app)).rejects.toThrow(/No view registered/);
  });
});

describe("Attest vault warm-up caches", () => {
  let app: App;
  let plugin: AttestPlugin;

  beforeEach(async () => {
    createContainer();
    app = new App();
    plugin = createPlugin(app);
    await plugin.onload();
  });

  afterEach(async () => {
    restoreDomTimers();
    resetDom();
  });

  it("releases its vault subscriptions when the plugin unloads", () => {
    expect(app.vault.listenerCount("create")).toBe(1);
    expect(app.vault.listenerCount("delete")).toBe(1);
    expect(app.vault.listenerCount("rename")).toBe(1);

    plugin.unload();

    expect(app.vault.listenerCount("create")).toBe(0);
    expect(app.vault.listenerCount("delete")).toBe(0);
    expect(app.vault.listenerCount("rename")).toBe(0);
  });
});

describe("Attest chat session ownership", () => {
  let app: App;
  let plugin: AttestPlugin;

  beforeEach(async () => {
    createContainer();
    app = new App();
    plugin = createPlugin(app);
    await plugin.onload();
  });

  afterEach(async () => {
    restoreDomTimers();
    resetDom();
  });

  it("keeps one manager across chat leaves and disposes it on unload", async () => {
    const manager = plugin.chatSessions;
    const first = await openChatLeaf(app);
    const second = await openChatLeaf(app);

    expect(plugin.chatSessions).toBe(manager);
    const session = manager.createSession({
      chatModelProfileId: "model",
      searchMode: "indexOnly",
    });
    manager.select(session.sessionId);
    await first.detach();
    expect(manager.getSession(session.sessionId)).toBe(session);

    await second.detach();
    plugin.unload();

    expect(manager.listSessions()).toEqual([]);
  });

  it("normalizes a stale persisted run before any chat view can observe it", async () => {
    const staleChat = {
      schemaVersion: 4,
      id: "stale-chat",
      title: "Interrupted by a crash",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T10:00:00.000Z",
      messages: [{ role: "user", content: "Question?", createdAt: "2026-06-01T10:00:00.000Z" }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: { chatModelProfileId: "model", searchMode: "indexOnly" },
      sourceRegistry: { sources: [] },
      unreadCompletion: false,
      lastRun: { runId: "run-1", startedAt: "2026-06-01T10:00:00.000Z", status: "running" },
    };
    const adapter = app.vault.adapter as {
      mkdir(path: string): Promise<void>;
      write(path: string, data: string): Promise<void>;
      read(path: string): Promise<string>;
    };
    await adapter.mkdir(".attest/chats");
    await adapter.write(".attest/chats/stale-chat.json", `${JSON.stringify(staleChat, null, 2)}\n`);

    const recovered = createPlugin(app);
    await recovered.onload();

    const raw = JSON.parse(await adapter.read(".attest/chats/stale-chat.json")) as {
      updatedAt: string;
      lastRun: { status: string; interruptionReason: string };
    };
    expect(raw.lastRun).toMatchObject({
      status: "interrupted",
      interruptionReason: "crash-recovery",
    });
    expect(raw.updatedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(recovered.chatSessions.status("stale-chat")).toBe("idle");
    recovered.unload();
  });
});
