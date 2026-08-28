import { App, Component } from "obsidian";

import { createTranslator } from "@adapters/i18n";
import { DEFAULT_SETTINGS } from "@adapters/settings";
import { WebSourceHealthTracker } from "@application/web";
import { renderWorkflowNodes } from "@apps/obsidian/ui/chat/workflowRenderer";
import { renderChatWindowActions } from "@apps/obsidian/ui/chat/ChatHeader";
import {
  renderSavedChatsEmptyState,
  renderSavedChatsPopoverContent,
} from "@apps/obsidian/ui/chat/history/SavedChatsPanel";
import {
  renderIndexSearchPanel,
  renderIndexSearchResults,
} from "@apps/obsidian/ui/index/IndexSearchPanel";
import { AdvancedSettingsSection } from "@apps/obsidian/ui/settings/AdvancedSettingsSection";
import { RetrievalSettingsSection } from "@apps/obsidian/ui/settings/RetrievalSettingsSection";
import type { ChainItem, ChatDisplayMessage } from "@core/conversation";
import type { ChatSessionStatus } from "@core/chat/chatSession";
import type { RetrievedChunk } from "@core/model";
import { createContainer } from "./domHarness";
import { markdownSource, retrieved } from "./factories";

const searchCall: ChainItem = {
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

const chunk: RetrievedChunk = retrieved("c1", markdownSource("notes/found.md"), "matched", 0.9);

const t = createTranslator("en").t;

function workflowMessage(chain: ChainItem[], finalizing: boolean): ChatDisplayMessage {
  return {
    role: "assistant",
    content: "Answer",
    createdAt: "2026-01-01T00:00:00.000Z",
    researchProgress: {
      phase: "streaming",
      disclosure: "auto",
      view: "expanded",
      reasoning: { phase: "streaming", segments: [] },
      checkpoints: finalizing
        ? [{ id: "c1", round: 1, content: "Wrapping up", status: "finalizing" }]
        : [],
      chain,
    },
  };
}

function renderWorkflowSurfaces(host: HTMLElement): void {
  const transcript = host.createDiv({ cls: "attest-chat__transcript" });
  const context = {
    app: new App(),
    markdownContext: new Component(),
    isDebugMode: true,
    t,
    onOpenToolOutput: () => {},
  };
  renderWorkflowNodes(
    transcript.createDiv(),
    workflowMessage(
      [{ kind: "reasoning", segmentId: "s1", content: "Planning the search" }, searchCall],
      false,
    ),
    context,
  );
  renderWorkflowNodes(
    transcript.createDiv(),
    workflowMessage([searchCall, pendingFetch], false),
    context,
  );
  renderWorkflowNodes(transcript.createDiv(), workflowMessage([searchCall], true), context);
}

function renderIndexSearchSurfaces(host: HTMLElement): void {
  const panelHost = host.createDiv();
  renderIndexSearchPanel(panelHost, {
    profiles: [{ id: "ready", name: "Ready", isIndexed: true }],
    selectedProfileId: "ready",
    results: [chunk],
    error: null,
    warning: "Embedder is missing.",
    isSearchBlocked: true,
    isSearching: false,
    t,
    onSubmit: () => {},
    onOpenResult: () => {},
  });
  renderIndexSearchResults(host.createDiv(), {
    results: [],
    error: "Search failed.",
    warning: null,
    isSearching: false,
    t,
    onOpenResult: () => {},
  });
}

function renderSavedChatSurfaces(host: HTMLElement): void {
  const savedChats = [
    {
      id: "a",
      title: "First chat",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messageCount: 4,
      isFavorite: true,
      unreadCompletion: false,
    },
    {
      id: "b",
      title: "Second chat",
      updatedAt: "2026-01-02T00:00:00.000Z",
      messageCount: 2,
      isFavorite: false,
      unreadCompletion: true,
    },
  ];
  const getChatStatus = (id: string): ChatSessionStatus => (id === "a" ? "running" : "completed");
  renderSavedChatsEmptyState(host.createDiv(), {
    savedChats,
    t,
    onOpenChat: () => {},
    onViewAll: () => {},
    onToggleFavorite: () => {},
    onRenameChat: () => {},
    onDeleteChat: () => {},
    getChatStatus,
    onStopChat: () => {},
  });
  for (const activeTab of ["history", "favorites"] as const) {
    renderSavedChatsPopoverContent(host.createDiv({ cls: "attest-chat__history-popover" }), {
      savedChats,
      currentChatId: "a",
      searchQuery: "",
      activeTab,
      t,
      onSearchQueryChange: () => {},
      onTabChange: () => {},
      onOpenChat: () => {},
      onToggleFavorite: () => {},
      onRenameChat: () => {},
      onDeleteChat: () => {},
      getChatStatus,
      onStopChat: () => {},
    });
  }
  renderChatWindowActions(host.createDiv({ cls: "attest-chat__toolbar" }), {
    activePanel: "chat",
    hasCompletedAnswer: true,
    isDebugMode: true,
    historyActivity: { runningCount: 2, unreadCompletedCount: 1 },
    t,
    onPanelChange: () => {},
    onOpenHistory: () => {},
    onOpenSources: () => {},
    onNewChat: () => {},
  });
}

function renderSettingsSurfaces(host: HTMLElement): void {
  for (const hasActiveChatModel of [false, true]) {
    new RetrievalSettingsSection({
      app: new App(),
      t,
      settings: structuredClone(DEFAULT_SETTINGS),
      webSourceHealth: new WebSourceHealthTracker(),
      hasActiveChatModel,
      saveSettings: async () => {},
      requestRedisplay: () => {},
    }).render(host.createDiv());
  }
  new AdvancedSettingsSection({
    t,
    isDebugMode: () => true,
    setDebugMode: () => {},
    saveSettings: async () => {},
    refreshChatViews: () => {},
  }).render(host.createDiv());
}

/**
 * Renders the UI surfaces whose stylesheets this repository ships and returns
 * every CSS class the renderers applied. New classes added inside these
 * renderers are picked up without editing the catalogue.
 */
export function renderStyleCatalogue(): Set<string> {
  const host = createContainer();
  renderWorkflowSurfaces(host);
  renderIndexSearchSurfaces(host);
  renderSavedChatSurfaces(host);
  renderSettingsSurfaces(host);

  const applied = new Set<string>();
  for (const el of Array.from(host.querySelectorAll("*"))) {
    el.classList.forEach((name) => applied.add(name));
  }
  return applied;
}
