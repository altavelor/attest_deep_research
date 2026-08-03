// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";

import { DEFAULT_SETTINGS, cloneIndexProfile } from "@adapters/settings";
import type { ChatModelProfile, IxplorerSettings, ServerProfile } from "@adapters/settings";
import { PluginDebugLogger } from "@adapters/settings";
import { SettingsCapabilityProber } from "@apps/obsidian/ui/settings/SettingsCapabilityProber";
import { IxplorerSettingTab } from "@apps/obsidian/ui/SettingsTab";
import IxplorerPluginClass from "@apps/obsidian/main";
import type IxplorerPlugin from "@apps/obsidian/main";
import {
  installObsidianDomHelpers,
  pendingTimerCount,
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
    reasoning: { mode: "off", summary: "off" },
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
  };
}

function createProberHost(settings: IxplorerSettings): IxplorerPlugin {
  return {
    settings,
    logger: new PluginDebugLogger({ getSettings: () => settings }),
    saveSettings: async () => {},
  } as unknown as IxplorerPlugin;
}

function createPlugin(app: App, settings: IxplorerSettings): IxplorerPlugin {
  const plugin = new IxplorerPluginClass(app as unknown as ObsidianApp, {
    id: "ixplorer",
    name: "Ixplorer",
    version: "0.0.0",
    minAppVersion: "1.0.0",
    author: "test",
    description: "test",
  });
  plugin.settings = settings;
  return plugin;
}

describe("settings capability prober subscriptions", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    useDomFakeTimers();
  });

  afterEach(() => {
    restoreDomTimers();
    resetDom();
    vi.restoreAllMocks();
  });

  it("notifies every live subscriber and stops notifying a released one", () => {
    const settings = createSettings();
    const prober = new SettingsCapabilityProber({
      plugin: createProberHost(settings),
      fetchedModelsByServerId: new Map(),
      requestRedisplay: () => {},
    });
    const first: string[] = [];
    const second: string[] = [];
    const releaseFirst = prober.subscribeAll(() =>
      first.push(prober.statusFor(chatProfile()).tools),
    );
    prober.subscribeAll(() => second.push(prober.statusFor(chatProfile()).tools));

    prober.startChatProfileProbes("chat");

    expect(first).toEqual(["testing"]);
    expect(second).toEqual(["testing"]);

    releaseFirst();
    prober.startChatProfileProbes("chat");

    expect(first).toEqual(["testing"]);
    expect(second).toEqual(["testing", "testing"]);
  });

  it("does not accumulate a redisplay subscription across repeated display() calls", () => {
    const settings = createSettings();
    const app = new App();
    const tab = new IxplorerSettingTab(app as unknown as ObsidianApp, createPlugin(app, settings));
    const prober = (tab as unknown as { prober: SettingsCapabilityProber }).prober;

    tab.display();
    tab.display();
    tab.display();
    expect(pendingTimerCount()).toBe(0);

    prober.startChatProfileProbes("chat");

    expect(pendingTimerCount()).toBe(1);
  });

  it("releases the redisplay subscription on hide()", () => {
    const settings = createSettings();
    const app = new App();
    const tab = new IxplorerSettingTab(app as unknown as ObsidianApp, createPlugin(app, settings));
    const prober = (tab as unknown as { prober: SettingsCapabilityProber }).prober;

    tab.display();
    tab.hide();
    prober.startChatProfileProbes("chat");

    expect(pendingTimerCount()).toBe(0);
  });
});
