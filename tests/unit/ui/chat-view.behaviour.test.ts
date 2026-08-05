// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, View, WorkspaceLeaf } from "../../stubs/obsidian";
import type { WorkspaceLeaf as ObsidianWorkspaceLeaf } from "obsidian";

import {
  IXPLORER_CHAT_VIEW_TYPE,
  IxplorerChatView,
  type IxplorerChatViewServices,
} from "@apps/obsidian/ui/chat/IxplorerChatView";
import type { ChainItem, ChatDisplayMessage } from "@core/conversation";
import type { SavedChat, SavedChatSummary } from "@core/chat/savedChat";
import {
  advanceTime,
  installObsidianDomHelpers,
  pendingTimerCount,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";

const searchWeb: ChainItem = {
  kind: "tool-call",
  id: "search",
  name: "search_web",
  label: "Search the web",
  status: "complete",
  args: { query: "obsidian" },
  resultJson: JSON.stringify({
    value: {
      results: [
        { resultId: "r1", url: "https://alpha.example/a" },
        { resultId: "r2", url: "https://beta.example/b" },
      ],
    },
  }),
};

const pendingFetch: ChainItem = {
  kind: "tool-call",
  id: "fetch",
  name: "fetch_web_page",
  label: "Read pages",
  status: "pending",
  args: { resultIds: ["r1", "r2"] },
};

const streamingAssistant: ChatDisplayMessage = {
  role: "assistant",
  content: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  researchProgress: {
    phase: "streaming",
    disclosure: "auto",
    view: "expanded",
    reasoning: { phase: "complete", segments: [] },
    checkpoints: [],
    chain: [searchWeb, pendingFetch],
  },
};

const summary: SavedChatSummary = {
  id: "chat-1",
  title: "Pending fetch",
  updatedAt: "2026-01-01T00:00:00.000Z",
  messageCount: 2,
  isFavorite: false,
};

const savedChat: SavedChat = {
  schemaVersion: 2,
  id: summary.id,
  title: summary.title,
  createdAt: summary.updatedAt,
  updatedAt: summary.updatedAt,
  messages: [{ role: "user", content: "Find sources", createdAt: summary.updatedAt }],
  lastAnswer: null,
  attachedContextPaths: [],
  chatSettings: { chatModelProfileId: "model", indexProfileId: "index", searchMode: "indexOnly" },
};

function createServices(overrides: Partial<IxplorerChatViewServices> = {}) {
  const services: IxplorerChatViewServices = {
    createResearchService: () => {
      throw new Error("The test must not start a research run.");
    },
    isWebSearchEnabled: () => true,
    getChatModel: () => "model",
    getAvailableChatModels: () => ["model"],
    getChatModelProfiles: () => [{ id: "model", name: "Model" }],
    getDefaultChatModelProfileId: () => "model",
    getDefaultIndexProfileId: () => "index",
    getDefaultSearchMode: () => "indexOnly",
    getDefaultResearchMode: () => "instant",
    getIndexProfiles: () => [{ id: "index", name: "Index", isIndexed: true }],
    getIndexSearchEmbedderWarning: () => undefined,
    openIndexSettings: () => {},
    searchIndex: async () => ({ chunks: [] }),
    listSavedChats: async () => [summary],
    loadSavedChat: async () => savedChat,
    saveChat: async () => savedChat,
    renameSavedChat: async () => {},
    setSavedChatFavorite: async () => {},
    deleteSavedChat: async () => {},
    isDebugMode: () => true,
    shouldIncludeActiveFileContext: () => false,
    ...overrides,
  };
  return services;
}

async function openView(overrides: Partial<IxplorerChatViewServices> = {}) {
  const app = new App();
  const workspace = app.workspace;
  const services = createServices(overrides);
  workspace.registerViewFactory(
    IXPLORER_CHAT_VIEW_TYPE,
    (leaf) =>
      new IxplorerChatView(leaf as unknown as ObsidianWorkspaceLeaf, services) as unknown as View,
  );
  const leaf: WorkspaceLeaf = workspace.createLeaf();
  await leaf.setViewState({ type: IXPLORER_CHAT_VIEW_TYPE });
  const view = leaf.view as unknown as IxplorerChatView;
  return { app, workspace, leaf, view, services };
}

function panelState(view: IxplorerChatView) {
  const root = view.contentEl;
  const chatPanel = root.querySelector<HTMLElement>(".ixplorer-chat__panel");
  const indexPanel = root.querySelector<HTMLElement>(".ixplorer-index-search");
  return {
    chatHidden: chatPanel?.classList.contains("is-hidden") ?? null,
    indexPresent: indexPanel !== null,
    indexHidden: indexPanel?.classList.contains("is-hidden") ?? null,
    selectedTabs: Array.from(
      root.querySelectorAll('.ixplorer-chat__tab[aria-selected="true"]'),
      (tab) => tab.textContent,
    ),
  };
}

function tab(view: IxplorerChatView, label: string): HTMLButtonElement {
  const found = Array.from(
    view.contentEl.querySelectorAll<HTMLButtonElement>(".ixplorer-chat__tab"),
  ).find((button) => button.textContent === label);
  if (!found) throw new Error(`No "${label}" tab is rendered.`);
  return found;
}

beforeEach(() => {
  installObsidianDomHelpers();
});

afterEach(() => {
  restoreDomTimers();
  resetDom();
  vi.restoreAllMocks();
});

describe("chat view panel selection", () => {
  it("renders both panels in debug mode with chat selected", async () => {
    const { view, leaf } = await openView();

    expect(panelState(view)).toEqual({
      chatHidden: false,
      indexPresent: true,
      indexHidden: true,
      selectedTabs: ["Chat"],
    });
    await leaf.detach();
  });

  it("switches to the index search panel when its tab is activated", async () => {
    const { view, leaf } = await openView();

    tab(view, "Index search").click();

    expect(panelState(view)).toEqual({
      chatHidden: true,
      indexPresent: true,
      indexHidden: false,
      selectedTabs: ["Index search"],
    });

    tab(view, "Chat").click();
    expect(panelState(view).chatHidden).toBe(false);
    await leaf.detach();
  });

  it("hides the tabs and the index search panel outside debug mode", async () => {
    const { view, leaf } = await openView({ isDebugMode: () => false });

    expect(view.contentEl.querySelectorAll(".ixplorer-chat__tab")).toHaveLength(0);
    expect(panelState(view)).toEqual({
      chatHidden: false,
      indexPresent: false,
      indexHidden: null,
      selectedTabs: [],
    });
    await leaf.detach();
  });

  it("falls back to the chat panel when debug mode is turned off while index search is open", async () => {
    let debugMode = true;
    const { view, leaf } = await openView({ isDebugMode: () => debugMode });

    tab(view, "Index search").click();
    expect(panelState(view).chatHidden).toBe(true);

    debugMode = false;
    view.redisplay();

    expect(panelState(view)).toEqual({
      chatHidden: false,
      indexPresent: false,
      indexHidden: null,
      selectedTabs: [],
    });
    await leaf.detach();
  });
});

describe("chat view transcript disposal", () => {
  async function openWithPendingFetch() {
    const opened = await openView({
      loadSavedChat: async () => ({
        ...savedChat,
        messages: [...savedChat.messages, streamingAssistant],
      }),
    });
    opened.view.contentEl.querySelector<HTMLElement>(".ixplorer-chat__saved-open")?.click();
    await vi.waitFor(() => {
      if (!opened.view.contentEl.querySelector(".ixplorer-chat__tool-fetch-target")) {
        throw new Error("The pending fetch targets were not rendered yet.");
      }
    });
    return opened;
  }

  it("releases the fetch-target timer when the view closes", async () => {
    const { view, leaf } = await openWithPendingFetch();
    useDomFakeTimers();
    view.redisplay();

    expect(pendingTimerCount()).toBe(1);

    await leaf.detach();

    expect(pendingTimerCount()).toBe(0);
  });

  it("releases the previous transcript timer on every redisplay", async () => {
    const { view, leaf } = await openWithPendingFetch();
    useDomFakeTimers();
    view.redisplay();
    await advanceTime(1_000);
    view.redisplay();

    expect(pendingTimerCount()).toBe(1);

    await leaf.detach();
  });
});
