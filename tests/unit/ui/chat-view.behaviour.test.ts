// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, View, WorkspaceLeaf, takeNotices } from "../../stubs/obsidian";
import type { WorkspaceLeaf as ObsidianWorkspaceLeaf } from "obsidian";

import {
  ATTEST_CHAT_VIEW_TYPE,
  AttestChatView,
  openExternalUrlWithAnchor,
  type AttestChatViewServices,
} from "@apps/obsidian/ui/chat/AttestChatView";
import { createTranslator } from "@adapters/i18n";
import type { ChainItem, ChatDisplayMessage } from "@core/conversation";
import type { SavedChat, SavedChatSummary } from "@core/chat/savedChat";
import type { Citation } from "@core/model";
import type { ResearchRequest } from "@application/contracts/research";
import type { ResearchService } from "@application/use-cases/research";
import {
  advanceTime,
  installObsidianDomHelpers,
  pendingTimerCount,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";
import { createTestSessionManager } from "../../helpers/chatSessions";

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
  unreadCompletion: false,
};

const savedChat: SavedChat = {
  schemaVersion: 4,
  id: summary.id,
  title: summary.title,
  createdAt: summary.updatedAt,
  updatedAt: summary.updatedAt,
  messages: [{ role: "user", content: "Find sources", createdAt: summary.updatedAt }],
  lastAnswer: null,
  attachedContextPaths: [],
  chatSettings: { chatModelProfileId: "model", indexProfileId: "index", searchMode: "indexOnly" },
  sourceRegistry: { sources: [] },
  unreadCompletion: false,
};

function createServices(overrides: Partial<AttestChatViewServices> = {}) {
  const partial = { ...overrides };
  const sessions =
    partial.sessions ??
    createTestSessionManager({
      createResearchService: (settings) =>
        services.createResearchService(
          settings.chatModelProfileId,
          settings.indexProfileId,
          settings.searchMode,
        ),
    }).manager;
  const services: AttestChatViewServices = {
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
    sessions,
    listSavedChats: async () => [summary],
    loadSavedChat: async () => savedChat,
    renameSavedChat: async () => {},
    setSavedChatFavorite: async () => {},
    getTranslator: () => createTranslator("en"),
    isDebugMode: () => true,
    shouldIncludeActiveFileContext: () => false,
    ...partial,
  };
  return services;
}

async function openView(overrides: Partial<AttestChatViewServices> = {}) {
  const app = new App();
  const workspace = app.workspace;
  const services = createServices(overrides);
  workspace.registerViewFactory(
    ATTEST_CHAT_VIEW_TYPE,
    (leaf) =>
      new AttestChatView(leaf as unknown as ObsidianWorkspaceLeaf, services) as unknown as View,
  );
  const leaf: WorkspaceLeaf = workspace.createLeaf();
  await leaf.setViewState({ type: ATTEST_CHAT_VIEW_TYPE });
  const view = leaf.view as unknown as AttestChatView;
  return { app, workspace, leaf, view, services };
}

function panelState(view: AttestChatView) {
  const root = view.contentEl;
  const chatPanel = root.querySelector<HTMLElement>(".attest-chat__panel");
  const indexPanel = root.querySelector<HTMLElement>(".attest-index-search");
  return {
    chatHidden: chatPanel?.classList.contains("is-hidden") ?? null,
    indexPresent: indexPanel !== null,
    indexHidden: indexPanel?.classList.contains("is-hidden") ?? null,
    selectedTabs: Array.from(
      root.querySelectorAll('.attest-chat__tab[aria-selected="true"]'),
      (tab) => tab.textContent,
    ),
  };
}

function tab(view: AttestChatView, label: string): HTMLButtonElement {
  const found = Array.from(
    view.contentEl.querySelectorAll<HTMLButtonElement>(".attest-chat__tab"),
  ).find((button) => button.textContent === label);
  if (!found) throw new Error(`No "${label}" tab is rendered.`);
  return found;
}

function openCitation(view: AttestChatView, citation: Citation): Promise<void> {
  return (
    view as unknown as {
      openCitation(citation: Citation): Promise<void>;
    }
  ).openCitation(citation);
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

    expect(view.contentEl.querySelectorAll(".attest-chat__tab")).toHaveLength(0);
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
    opened.view.contentEl.querySelector<HTMLElement>(".attest-chat__saved-open")?.click();
    await vi.waitFor(() => {
      if (!opened.view.contentEl.querySelector(".attest-chat__tool-fetch-target")) {
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

  it("keeps an active research request alive when the view closes", async () => {
    let request: ResearchRequest | undefined;
    const { view, leaf } = await openView({
      createResearchService: () =>
        ({
          answer: (nextRequest: ResearchRequest) => {
            request = nextRequest;
            return (async function* pendingAnswer() {
              await new Promise<void>((_resolve, reject) => {
                nextRequest.signal?.addEventListener(
                  "abort",
                  () => reject(nextRequest.signal?.reason),
                  { once: true },
                );
              });
            })();
          },
        }) as unknown as ResearchService,
    });
    const input = view.contentEl.querySelector<HTMLTextAreaElement>(".attest-chat__input");
    input!.value = "Keep researching";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    view.contentEl
      .querySelector<HTMLFormElement>(".attest-chat__form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(request).toBeDefined());

    await leaf.detach();
    for (let index = 0; index < 10; index += 1) await Promise.resolve();

    expect(request?.signal?.aborted).toBe(false);
    expect(takeNotices()).toEqual([]);
  });
});

describe("chat view citation navigation", () => {
  const webCitation: Citation = {
    id: "web-source",
    label: "Web source",
    source: {
      id: "web-source",
      kind: "web",
      title: "Web source",
      url: "https://example.com/research?q=mobile",
      snippet: "",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      wasContentFetched: true,
    },
  };

  it("uses the injected external opener for web citations", async () => {
    const openExternalUrl = vi.fn();
    const { view, workspace, leaf } = await openView({ openExternalUrl });

    await openCitation(view, webCitation);

    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/research?q=mobile");
    expect(workspace.openedLinks).toEqual([]);
    await leaf.detach();
  });

  it("keeps vault citations on Workspace.openLinkText", async () => {
    const openExternalUrl = vi.fn();
    const { view, workspace, leaf } = await openView({ openExternalUrl });

    await openCitation(view, {
      id: "vault-source",
      label: "Vault source",
      source: {
        id: "vault-source",
        kind: "markdown",
        title: "Vault source",
        path: "Notes/Mobile.md",
        headingPath: ["Support"],
      },
    });

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(workspace.openedLinks).toEqual([{ target: "Notes/Mobile.md", sourcePath: "" }]);
    await leaf.detach();
  });

  it("rejects non-http external citation targets before invoking the opener", async () => {
    const openExternalUrl = vi.fn();
    const { view, leaf } = await openView({ openExternalUrl });

    await openCitation(view, {
      ...webCitation,
      source: {
        id: "unsafe-web",
        kind: "web",
        title: "Unsafe web source",
        url: "javascript:alert(1)",
        snippet: "",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        wasContentFetched: false,
      },
    });

    expect(openExternalUrl).not.toHaveBeenCalled();
    await leaf.detach();
  });

  it("uses a temporary anchor only for validated HTTP(S) fallback URLs", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    expect(openExternalUrlWithAnchor("https://example.com/source", document)).toBe(true);
    expect(openExternalUrlWithAnchor("javascript:alert(1)", document)).toBe(false);

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[href="https://example.com/source"]')).toBeNull();
  });
});

describe("saved chats from the chat view", () => {
  it("loads a saved conversation selected from the empty-chat history", async () => {
    const loadSavedChat = vi.fn(async () => savedChat);
    const { view, leaf } = await openView({ loadSavedChat });

    view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__saved-open")?.click();

    await vi.waitFor(() => {
      expect(loadSavedChat).toHaveBeenCalledWith(savedChat.id);
      expect(view.contentEl.querySelector(".attest-chat__message-text")?.textContent).toBe(
        "Find sources",
      );
    });
    expect(view.contentEl.querySelector(".attest-chat__empty-state")).toBeNull();
    await leaf.detach();
  });

  it("notifies the reader and refreshes the history when a listed chat was removed", async () => {
    const loadSavedChat = vi.fn(async () => null);
    const listSavedChats = vi.fn(async () => [summary]);
    const { view, leaf } = await openView({ loadSavedChat, listSavedChats });

    view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__saved-open")?.click();

    await vi.waitFor(() => expect(loadSavedChat).toHaveBeenCalledWith(summary.id));
    await vi.waitFor(() => {
      expect(takeNotices().map((notice) => notice.message)).toEqual(["Saved chat was not found."]);
    });
    expect(listSavedChats).toHaveBeenCalledTimes(2);
    expect(view.contentEl.querySelector(".attest-chat__empty-state")).not.toBeNull();
    await leaf.detach();
  });

  it("updates saved chats through the history popover", async () => {
    const setSavedChatFavorite = vi.fn(async () => {});
    const renameSavedChat = vi.fn(async () => {});
    const { manager, repository } = createTestSessionManager();
    const deleteSavedChat = vi.spyOn(repository, "deleteChat");
    const { view, leaf } = await openView({
      setSavedChatFavorite,
      renameSavedChat,
      sessions: manager,
    });

    view.contentEl.querySelectorAll<HTMLButtonElement>(".attest-chat__icon-button")[0]?.click();
    await vi.waitFor(() => {
      expect(view.contentEl.querySelector(".attest-chat__history-popover")).not.toBeNull();
    });

    view.contentEl.querySelectorAll<HTMLButtonElement>(".attest-chat__saved-action")[0]?.click();
    await vi.waitFor(() => expect(setSavedChatFavorite).toHaveBeenCalledWith(summary.id, true));

    view.contentEl.querySelectorAll<HTMLButtonElement>(".attest-chat__saved-action")[1]?.click();
    const titleInput = view.contentEl.querySelector<HTMLInputElement>(
      ".attest-chat__saved-title-input",
    );
    titleInput!.value = "Renamed research";
    titleInput!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(renameSavedChat).toHaveBeenCalledWith(summary.id, "Renamed research");
    });

    view.contentEl
      .querySelectorAll<HTMLButtonElement>(".attest-chat__saved-action--delete")[0]
      ?.click();
    await vi.waitFor(() => expect(deleteSavedChat).toHaveBeenCalledWith(summary.id));
    await vi.waitFor(() => {
      expect(takeNotices().map((notice) => notice.message)).toContain("Chat deleted.");
    });
    await leaf.detach();
  });

  it("saves the loaded conversation before starting a clean chat", async () => {
    const { manager, repository } = createTestSessionManager();
    const saveChat = vi.spyOn(repository, "saveChat");
    const { view, leaf } = await openView({ sessions: manager });

    view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__saved-open")?.click();
    await vi.waitFor(() => {
      expect(view.contentEl.querySelector(".attest-chat__message-text")?.textContent).toBe(
        "Find sources",
      );
    });

    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="New chat"]')?.click();
    await vi.waitFor(() => {
      expect(saveChat).toHaveBeenCalledWith(expect.objectContaining({ id: savedChat.id }));
      expect(view.contentEl.querySelector(".attest-chat__message")).toBeNull();
    });
    expect(view.contentEl.querySelector(".attest-chat__empty-state")).not.toBeNull();
    await leaf.detach();
  });
});

describe("chat view research composition", () => {
  it("composes the research turn for the active search mode", async () => {
    const createResearchService = vi.fn(() => ({
      answer: async function* answer() {
        return;
      },
    }));
    const { view, leaf } = await openView({
      getDefaultSearchMode: () => "webOnly",
      createResearchService:
        createResearchService as unknown as AttestChatViewServices["createResearchService"],
    });

    const input = view.contentEl.querySelector<HTMLTextAreaElement>("textarea.attest-chat__input");
    input!.value = "What happened today?";
    input!.dispatchEvent(new Event("input"));
    view.contentEl.querySelector<HTMLButtonElement>("button.attest-chat__submit")?.click();

    await vi.waitFor(() => {
      expect(createResearchService).toHaveBeenCalledWith("model", "index", "webOnly");
    });
    await leaf.detach();
  });
});
