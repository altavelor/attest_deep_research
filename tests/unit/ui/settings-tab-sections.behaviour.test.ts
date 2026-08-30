// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Setting } from "../../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";
import type { SettingGroup } from "obsidian";

import { DEFAULT_SETTINGS, cloneIndexProfile, DEFAULT_INDEX_PROFILE } from "@adapters/settings";
import type { ChatModelProfile, AttestSettings, ServerProfile } from "@adapters/settings";
import { AttestSettingTab } from "@apps/obsidian/ui/SettingsTab";
import AttestPluginClass from "@apps/obsidian/main";
import type AttestPlugin from "@apps/obsidian/main";
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

function createSettings(): AttestSettings {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: [DEFAULT_INDEX_PROFILE].map(cloneIndexProfile),
    embeddingModelProfiles: [],
    serverProfiles: [serverProfile()],
    chatModelProfiles: [chatProfile()],
    newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults, chatModelProfileId: "chat" },
  };
}

function createTab(): AttestSettingTab {
  const app = new App();
  const settings = createSettings();
  const plugin = new AttestPluginClass(app as unknown as ObsidianApp, {
    id: "attest",
    name: "Attest",
    version: "0.0.0",
    minAppVersion: "1.0.0",
    author: "test",
    description: "test",
  });
  plugin.settings = settings;
  const tab = new AttestSettingTab(app as unknown as ObsidianApp, plugin as AttestPlugin);
  tab.display();
  return tab;
}

function renderTab(): HTMLElement {
  return createTab().containerEl;
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

  it("lets open chat views pick up a settings change while they stay open", async () => {
    const tab = createTab();
    const plugin = (tab as unknown as { plugin: AttestPlugin }).plugin;
    vi.spyOn(plugin, "saveSettings").mockResolvedValue(undefined);
    const refreshed = vi.spyOn(plugin, "refreshChatViews").mockImplementation(() => {});
    const setting = Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
      (item) => item.firstElementChild?.textContent?.trim() === "Use linked notes",
    );
    const toggle = setting?.querySelector<HTMLInputElement>('input[type="checkbox"]');

    toggle?.click();
    await vi.waitFor(() => expect(refreshed).toHaveBeenCalled());

    expect(toggle).toBeDefined();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("offers the wizard again once the vault is configured", () => {
    const tab = createTab();
    const plugin = (tab as unknown as { plugin: AttestPlugin }).plugin;
    const opened = vi.spyOn(plugin, "openOnboarding").mockImplementation(() => {});
    tab.display();
    const names = settingNames(tab.containerEl);
    expect(names).toContain("Setup wizard");

    const rerun = Array.from(tab.containerEl.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Run setup again",
    );
    rerun?.click();

    expect(rerun).toBeDefined();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(typeof opened.mock.calls[0][0]).toBe("function");
  });

  it("renders the retrieval, search, and web controls the tab owns", () => {
    const names = settingNames(renderTab());

    expect(names.filter((name) => name === "Include active file as context")).toHaveLength(1);
    expect(names).toContain("Use linked notes");
    expect(names).toContain("Expand search query");
    expect(names).toContain("Use web for freshness questions");
    expect(names).toContain("Debug mode");
  });

  it("exposes searchable definitions that render the complete settings UI", () => {
    const tab = createTab();
    const [rawDefinition] = tab.getSettingDefinitions();
    const definition = rawDefinition as
      | {
          name: string;
          aliases?: string[];
          render: (setting: import("obsidian").Setting, group: SettingGroup) => void | (() => void);
        }
      | undefined;

    expect(definition?.name).toBe("Attest");
    expect(definition?.aliases).toContain("web search");
    if (!definition) throw new Error("Expected render definition");

    const host = document.createElement("div");
    const cleanup = definition.render(
      new Setting(host) as unknown as import("obsidian").Setting,
      {} as SettingGroup,
    );

    expect(settingNames(host)).toContain("Use web for freshness questions");
    expect(cleanup).toBeTypeOf("function");
    cleanup?.();
  });

  it("keeps the scroll offset when a section asks for a redisplay", () => {
    const tab = createTab();
    const container = tab.containerEl;
    const empty = container.empty.bind(container);
    // A real browser clamps scrollTop to 0 once the emptied content collapses;
    // happy-dom has no layout, so the redisplay must be told to do the same.
    container.empty = () => {
      empty();
      container.scrollTop = 0;
    };
    container.scrollTop = 240;

    tab.display();

    expect(container.scrollTop).toBe(240);
  });

  it("renders every new chat default with its source options", () => {
    const container = renderTab();
    const names = settingNames(container);

    expect(names).toContain("Default source");
    expect(names).toContain("Default index");
    expect(names).toContain("Default mode");
    expect(names).toContain("Default model");
    expect(names).toContain("Include active file as context");

    const sourceOptions = Array.from(
      container.querySelectorAll<HTMLSelectElement>("select"),
    ).flatMap((select) =>
      Array.from(select.options).some((option) => option.value === "indexAndWeb")
        ? [Array.from(select.options).map((option) => option.textContent)]
        : [],
    );
    expect(sourceOptions).toEqual([["None", "Index", "Web", "Index + Web"]]);
  });

  it("disables the thinking default for a model without a verified agent capability", () => {
    const container = renderTab();
    const modeSelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find(
      (select) => Array.from(select.options).some((option) => option.value === "thinking"),
    );

    expect(modeSelect).toBeDefined();
    expect(
      Array.from(modeSelect!.options).find((option) => option.value === "thinking")?.disabled,
    ).toBe(true);
  });

  it("offers no default model badge or action in the chat model table", () => {
    const container = renderTab();

    expect(container.querySelector('button[aria-label="Set as default model"]')).toBeNull();
    expect(
      Array.from(container.querySelectorAll(".attest-settings-profile-list__status")).map(
        (status) => status.textContent,
      ),
    ).not.toContain("Default");
  });

  it("renders the category headings in their declared order", () => {
    const container = renderTab();
    const headings = Array.from(
      container.querySelectorAll(".attest-settings__category-heading"),
    ).map((item) => item.firstElementChild?.textContent?.trim() ?? "");

    expect(headings).toEqual([
      "Attest",
      "Model profiles",
      "New chat defaults",
      "Retrieval",
      "Language",
    ]);
  });

  it("renders the indexing section before the advanced section", () => {
    const container = renderTab();
    const indexing = container.querySelector(".attest-settings-index-table");
    const advanced = container.querySelector(".attest-settings-advanced");

    expect(indexing).not.toBeNull();
    expect(advanced).not.toBeNull();
    expect(
      indexing!.compareDocumentPosition(advanced!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
