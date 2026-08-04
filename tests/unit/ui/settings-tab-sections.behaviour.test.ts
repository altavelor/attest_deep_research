// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";

import { DEFAULT_SETTINGS, cloneIndexProfile } from "@adapters/settings";
import type { ChatModelProfile, IxplorerSettings, ServerProfile } from "@adapters/settings";
import { IxplorerSettingTab } from "@apps/obsidian/ui/SettingsTab";
import IxplorerPluginClass from "@apps/obsidian/main";
import type IxplorerPlugin from "@apps/obsidian/main";
import {
  installObsidianDomHelpers,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";

vi.mock("@adapters/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/settings")>();
  return {
    ...actual,
    fetchAvailableModels: vi.fn(async () => ({ models: [], message: "no models" })),
    startChatProfileProbes: vi.fn(),
  };
});

function serverProfile(): ServerProfile {
  return {
    id: "server",
    name: "Server",
    apiFormat: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function chatProfile(): ChatModelProfile {
  return {
    id: "chat",
    name: "Chat",
    serverProfileId: "server",
    modelName: "model",
    toolsEnabled: true,
    noteMutationAccess: false,
    reasoning: { mode: "on", effort: "medium", summary: "off" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createSettings(): IxplorerSettings {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: DEFAULT_SETTINGS.indexProfiles.map(cloneIndexProfile),
    embeddingModelProfiles: [],
    serverProfiles: [serverProfile()],
    chatModelProfiles: [chatProfile()],
    activeChatModelProfileId: "chat",
  };
}

function renderTab(): HTMLElement {
  const app = new App();
  const settings = createSettings();
  const plugin = new IxplorerPluginClass(app as unknown as ObsidianApp, {
    id: "ixplorer",
    name: "Ixplorer",
    version: "0.0.0",
    minAppVersion: "1.0.0",
    author: "test",
    description: "test",
  });
  plugin.settings = settings;
  const tab = new IxplorerSettingTab(app as unknown as ObsidianApp, plugin as IxplorerPlugin);
  tab.display();
  return tab.containerEl;
}

function settingNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".setting-item"))
    .map((item) => item.firstElementChild?.textContent?.trim() ?? "")
    .filter((name) => name.length > 0);
}

describe("settings tab sections", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    useDomFakeTimers();
  });

  afterEach(() => {
    restoreDomTimers();
    resetDom();
    vi.restoreAllMocks();
  });

  it("renders the retrieval, search, and web controls the tab owns", () => {
    const names = settingNames(renderTab());

    expect(names).toContain("Include active file as context");
    expect(names).toContain("Use linked notes");
    expect(names).toContain("Expand search query");
    expect(names).toContain("Use web for freshness questions");
    expect(names).toContain("Debug mode");
  });

  it("renders the category headings in their declared order", () => {
    const container = renderTab();
    const headings = Array.from(
      container.querySelectorAll(".ixplorer-settings__category-heading"),
    ).map((item) => item.firstElementChild?.textContent?.trim() ?? "");

    expect(headings).toEqual(["Ixplorer", "Model profiles", "Retrieval"]);
  });

  it("renders the indexing section before the advanced section", () => {
    const container = renderTab();
    const indexing = container.querySelector(".ixplorer-settings-index-table");
    const advanced = container.querySelector(".ixplorer-settings-advanced");

    expect(indexing).not.toBeNull();
    expect(advanced).not.toBeNull();
    expect(
      indexing!.compareDocumentPosition(advanced!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
