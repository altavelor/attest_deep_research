// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App, TFile, View, WorkspaceLeaf } from "../../stubs/obsidian";
import type {
  App as ObsidianApp,
  TFile as ObsidianTFile,
  WorkspaceLeaf as ObsidianWorkspaceLeaf,
} from "obsidian";

import {
  ATTEST_CHAT_VIEW_TYPE,
  AttestChatView,
  type AttestChatViewServices,
} from "@apps/obsidian/ui/chat/AttestChatView";
import { createTranslator } from "@adapters/i18n";
import type { UiTranslator } from "@adapters/i18n";
import { installObsidianDomHelpers, resetDom } from "../../helpers/domHarness";
import { ContextDocumentPickerModal } from "@apps/obsidian/ui/chat/context/ContextDocumentPickerModal";
import { createTestSessionManager } from "../../helpers/chatSessions";

const PROBE_KEY = "chat.composer.placeholder";

function createServices(getTranslator: () => UiTranslator): AttestChatViewServices {
  return {
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
    sessions: createTestSessionManager().manager,
    listSavedChats: async () => [],
    loadSavedChat: async () => null,
    renameSavedChat: async () => {},
    setSavedChatFavorite: async () => {},
    getTranslator,
    isDebugMode: () => false,
    shouldIncludeActiveFileContext: () => false,
  };
}

async function openView(getTranslator: () => UiTranslator) {
  const app = new App();
  const services = createServices(getTranslator);
  app.workspace.registerViewFactory(
    ATTEST_CHAT_VIEW_TYPE,
    (leaf) =>
      new AttestChatView(leaf as unknown as ObsidianWorkspaceLeaf, services) as unknown as View,
  );
  const leaf: WorkspaceLeaf = app.workspace.createLeaf();
  await leaf.setViewState({ type: ATTEST_CHAT_VIEW_TYPE });
  return leaf.view as unknown as AttestChatView;
}

function composerPlaceholder(view: AttestChatView): string | null {
  return view.contentEl.querySelector("textarea")?.getAttribute("placeholder") ?? null;
}

beforeEach(() => {
  installObsidianDomHelpers();
});

afterEach(() => {
  resetDom();
});

describe("interface language applied without restarting Obsidian", () => {
  it("re-renders the chat view in the newly selected language", async () => {
    let translator = createTranslator("en");
    const view = await openView(() => translator);

    expect(composerPlaceholder(view)).toBe(createTranslator("en").t(PROBE_KEY));

    translator = createTranslator("ru");
    view.redisplay();

    const russian = createTranslator("ru").t(PROBE_KEY);
    expect(russian).not.toBe(createTranslator("en").t(PROBE_KEY));
    expect(composerPlaceholder(view)).toBe(russian);
  });

  it("switches the root container to right-to-left for Arabic and back", async () => {
    let translator = createTranslator("en");
    const view = await openView(() => translator);

    expect(view.contentEl.getAttribute("dir")).toBe("ltr");

    translator = createTranslator("ar");
    view.redisplay();
    expect(view.contentEl.getAttribute("dir")).toBe("rtl");

    translator = createTranslator("de");
    view.redisplay();
    expect(view.contentEl.getAttribute("dir")).toBe("ltr");
  });

  it("opens the context-document picker right-to-left after Arabic is selected", () => {
    let translator = createTranslator("en");
    const options = {
      files: [new TFile("note.md") as unknown as ObsidianTFile],
      selectedPaths: [],
      t: (key: Parameters<UiTranslator["t"]>[0], params?: Parameters<UiTranslator["t"]>[1]) =>
        translator.t(key, params),
      getDirection: () => translator.direction,
      onSubmit: () => {},
    };
    const modal = new ContextDocumentPickerModal(new App() as unknown as ObsidianApp, options);

    translator = createTranslator("ar");
    modal.open();

    expect(modal.modalEl.getAttribute("dir")).toBe("rtl");
    modal.close();
  });
});
