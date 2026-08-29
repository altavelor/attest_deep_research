// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, ItemView, TFile, WorkspaceLeaf, takeNotices } from "../../stubs/obsidian";
import type {
  Command as StubCommand,
  Editor as StubEditor,
  MarkdownFileInfo as StubMarkdownFileInfo,
  Plugin as StubPlugin,
} from "../../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";

import AttestPlugin from "@apps/obsidian/main";
import { cloneIndexProfile, DEFAULT_INDEX_PROFILE, DEFAULT_SETTINGS } from "@adapters/settings";
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

function registeredCommand(plugin: AttestPlugin, id: string): StubCommand {
  const command = asStubPlugin(plugin).commands.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Command ${id} is not registered.`);
  return command;
}

function markdownContext(
  path: string,
  selection = "",
): { editor: StubEditor; context: StubMarkdownFileInfo } {
  return {
    editor: { getSelection: () => selection },
    context: { file: new TFile(path) },
  };
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

    expect(asStubPlugin(plugin).commands.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "open-attest-chat", name: "Открыть чат Attest" },
      { id: "ask-current-note", name: "Спросить Attest о текущей заметке" },
      { id: "ask-selected-text", name: "Спросить Attest о выделенном тексте" },
      { id: "find-related-notes", name: "Найти связанные заметки" },
      { id: "run-setup", name: "Запустить первоначальную настройку" },
      { id: "update-index", name: "Обновить индекс Attest" },
      { id: "summarize-current-note", name: "Суммировать текущую заметку" },
    ]);
  });

  it("registers the Attest action commands", () => {
    expect(asStubPlugin(plugin).commands.map((command) => command.id)).toEqual([
      "open-attest-chat",
      "ask-current-note",
      "ask-selected-text",
      "find-related-notes",
      "run-setup",
      "update-index",
      "summarize-current-note",
    ]);
  });

  it("hides note actions outside a Markdown editor", () => {
    const { editor, context } = markdownContext("Documents/Reference.pdf", "selection");

    for (const id of [
      "ask-current-note",
      "ask-selected-text",
      "find-related-notes",
      "summarize-current-note",
    ]) {
      expect(registeredCommand(plugin, id).editorCheckCallback?.(true, editor, context)).toBe(
        false,
      );
    }
  });

  it("opens the right-sidebar chat from the ribbon", async () => {
    const [ribbon] = asStubPlugin(plugin).ribbonIcons;

    expect(ribbon?.getAttribute("aria-label")).toBe("Open Attest chat");
    ribbon?.click();

    await vi.waitFor(() => {
      expect(app.workspace.getLeavesOfType(ATTEST_CHAT_VIEW_TYPE)).toHaveLength(1);
    });
    expect(app.workspace.rightLeafRequests).toBe(1);
  });

  it("prepares the active note for an Attest question", async () => {
    const leaf = await openChatLeaf(app);
    const runCommand = vi.fn(async () => {});
    (leaf.view as unknown as { runCommand: typeof runCommand }).runCommand = runCommand;
    const command = registeredCommand(plugin, "ask-current-note");
    const { editor, context } = markdownContext("Notes/Current.md");

    expect(command.editorCheckCallback?.(true, editor, context)).toBe(true);
    command.editorCheckCallback?.(false, editor, context);

    await vi.waitFor(() => {
      expect(runCommand).toHaveBeenCalledWith({
        contextPaths: ["Notes/Current.md"],
        submit: false,
      });
    });
  });

  it("requires a non-empty selection and prepares it as editable quoted context", async () => {
    const leaf = await openChatLeaf(app);
    const runCommand = vi.fn(async () => {});
    (leaf.view as unknown as { runCommand: typeof runCommand }).runCommand = runCommand;
    const command = registeredCommand(plugin, "ask-selected-text");
    const empty = markdownContext("Notes/Current.md", "   ");
    const selected = markdownContext("Notes/Current.md", "First line\nSecond line");

    expect(command.editorCheckCallback?.(true, empty.editor, empty.context)).toBe(false);
    expect(command.editorCheckCallback?.(true, selected.editor, selected.context)).toBe(true);
    command.editorCheckCallback?.(false, selected.editor, selected.context);

    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledOnce());
    expect(runCommand).toHaveBeenCalledWith({
      contextPaths: ["Notes/Current.md"],
      question: expect.stringContaining("> First line\n> Second line"),
      submit: false,
    });
  });

  it("submits related-note and summary actions with explicit source scopes", async () => {
    const leaf = await openChatLeaf(app);
    const runCommand = vi.fn(async () => {});
    (leaf.view as unknown as { runCommand: typeof runCommand }).runCommand = runCommand;
    const { editor, context } = markdownContext("Notes/Current.md");

    registeredCommand(plugin, "find-related-notes").editorCheckCallback?.(false, editor, context);
    registeredCommand(plugin, "summarize-current-note").editorCheckCallback?.(
      false,
      editor,
      context,
    );

    await vi.waitFor(() => expect(runCommand).toHaveBeenCalledTimes(2));
    expect(runCommand).toHaveBeenNthCalledWith(1, {
      contextPaths: ["Notes/Current.md"],
      question: expect.any(String),
      searchMode: "indexOnly",
      submit: true,
    });
    expect(runCommand).toHaveBeenNthCalledWith(2, {
      contextPaths: ["Notes/Current.md"],
      question: expect.any(String),
      searchMode: "none",
      submit: true,
    });
  });

  it("starts an incremental update for the active index profile", async () => {
    plugin.settings.indexProfiles = [cloneIndexProfile(DEFAULT_INDEX_PROFILE)];
    const profileId = plugin.settings.indexProfiles[0].id;
    const start = vi
      .spyOn(plugin.indexing, "start")
      .mockResolvedValue(plugin.indexing.getState(profileId));

    registeredCommand(plugin, "update-index").callback?.();

    await vi.waitFor(() => expect(start).toHaveBeenCalledWith(profileId));
  });

  it("reports an index-update rejection instead of leaking it", async () => {
    const start = vi.spyOn(plugin.indexing, "start").mockRejectedValue(new Error("Index is busy"));

    registeredCommand(plugin, "update-index").callback?.();

    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(takeNotices().map((notice) => notice.message)).toEqual([
      "Something went wrong in Attest.",
    ]);
  });

  it("marks the resolved index profile stale when no default index is configured", () => {
    plugin.settings.indexProfiles = [cloneIndexProfile(DEFAULT_INDEX_PROFILE)];
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

  it("coalesces concurrent requests to open the chat", async () => {
    const [first, second] = await Promise.all([
      plugin.activateChatView(),
      plugin.activateChatView(),
    ]);

    expect(first).toBe(second);
    expect(app.workspace.getLeavesOfType(ATTEST_CHAT_VIEW_TYPE)).toHaveLength(1);
    expect(app.workspace.rightLeafRequests).toBe(1);
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
    expect(asStubPlugin(plugin).ribbonIcons).toHaveLength(1);

    plugin.unload();

    expect(app.workspace.getViewFactory(ATTEST_CHAT_VIEW_TYPE)).toBeUndefined();
    expect(asStubPlugin(plugin).commands).toHaveLength(0);
    expect(asStubPlugin(plugin).settingTabs).toHaveLength(0);
    expect(asStubPlugin(plugin).ribbonIcons).toHaveLength(0);
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

describe("Attest first-run wizard", () => {
  let app: App;
  let plugin: AttestPlugin;

  beforeEach(() => {
    createContainer();
    app = new App();
    plugin = createPlugin(app);
  });

  afterEach(() => {
    plugin.unload();
    restoreDomTimers();
    resetDom();
  });

  function wizardEl(): HTMLElement | null {
    return document.querySelector(".attest-onboarding");
  }

  it("opens once the layout is ready in a vault that was never configured", async () => {
    await plugin.onload();

    expect(wizardEl()).not.toBeNull();
  });

  it("leaves an already configured vault alone", async () => {
    await asStubPlugin(plugin).saveData({
      ...DEFAULT_SETTINGS,
      serverProfiles: [
        {
          id: "server-1",
          name: "OpenAI",
          apiFormat: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    await plugin.onload();

    expect(wizardEl()).toBeNull();
  });

  it("does not come back after it was finished or skipped", async () => {
    await asStubPlugin(plugin).saveData({ ...DEFAULT_SETTINGS, onboardingCompleted: true });

    await plugin.onload();

    expect(wizardEl()).toBeNull();
  });

  it("records the skip so the next launch stays quiet", async () => {
    await plugin.onload();

    const skip = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".attest-onboarding button"),
    ).find((button) => button.textContent === "Skip, configure manually");
    skip?.click();

    await vi.waitFor(() => expect(plugin.settings.onboardingCompleted).toBe(true));
    expect(wizardEl()).toBeNull();
  });

  it("can be reopened on demand from the setup command", async () => {
    await asStubPlugin(plugin).saveData({ ...DEFAULT_SETTINGS, onboardingCompleted: true });
    await plugin.onload();

    registeredCommand(plugin, "run-setup").callback?.();

    expect(wizardEl()).not.toBeNull();
  });

  it("keeps a single setup wizard when the command is invoked twice", async () => {
    await asStubPlugin(plugin).saveData({ ...DEFAULT_SETTINGS, onboardingCompleted: true });
    await plugin.onload();

    registeredCommand(plugin, "run-setup").callback?.();
    registeredCommand(plugin, "run-setup").callback?.();

    expect(document.querySelectorAll(".attest-onboarding")).toHaveLength(1);
  });

  it("tells the caller when the wizard closed, so settings can refresh behind it", async () => {
    await asStubPlugin(plugin).saveData({ ...DEFAULT_SETTINGS, onboardingCompleted: true });
    await plugin.onload();
    const closed = vi.fn();

    plugin.openOnboarding(closed);
    expect(closed).not.toHaveBeenCalled();
    const skip = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".attest-onboarding button"),
    ).find((candidate) => candidate.textContent === "Skip, configure manually");
    skip?.click();

    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });

  it("does not commit skipped settings after unload while persistence is pending", async () => {
    let release: (() => void) | undefined;
    vi.spyOn(asStubPlugin(plugin), "saveData").mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await plugin.onload();
    const skip = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".attest-onboarding button"),
    ).find((candidate) => candidate.textContent === "Skip, configure manually");

    skip?.click();
    plugin.unload();
    release?.();
    await Promise.resolve();

    expect(plugin.settings.onboardingCompleted).toBe(false);
  });

  it("does not commit completed settings after unload while persistence is pending", async () => {
    let release: (() => void) | undefined;
    vi.spyOn(asStubPlugin(plugin), "saveData").mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const complete = plugin as unknown as {
      completeOnboarding(result: {
        scope: "webOnly";
        chat: {
          server: { name: string; apiFormat: "openai-compatible"; baseUrl: string };
          modelName: string;
        };
      }): Promise<unknown>;
    };
    const pending = complete.completeOnboarding({
      scope: "webOnly",
      chat: {
        server: {
          name: "OpenAI",
          apiFormat: "openai-compatible",
          baseUrl: "https://api.openai.com/v1",
        },
        modelName: "gpt-4.1-mini",
      },
    });

    plugin.unload();
    release?.();
    await pending;

    expect(plugin.settings.serverProfiles).toHaveLength(0);
    expect(plugin.settings.onboardingCompleted).toBe(false);
  });
});
