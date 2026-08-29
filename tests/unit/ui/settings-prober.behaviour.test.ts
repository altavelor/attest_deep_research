// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";

import {
  DEFAULT_SETTINGS,
  cloneIndexProfile,
  fetchAvailableModels,
  DEFAULT_INDEX_PROFILE,
} from "@adapters/settings";
import type { ChatModelProfile, AttestSettings, ServerProfile } from "@adapters/settings";
import { PluginDebugLogger } from "@adapters/settings";
import * as settingsApi from "@adapters/settings";
import { SettingsCapabilityProber } from "@apps/obsidian/ui/settings/SettingsCapabilityProber";
import { AttestSettingTab } from "@apps/obsidian/ui/SettingsTab";
import AttestPluginClass from "@apps/obsidian/main";
import type AttestPlugin from "@apps/obsidian/main";
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

function createSettings(): AttestSettings {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: [DEFAULT_INDEX_PROFILE].map(cloneIndexProfile),
    embeddingModelProfiles: [],
    serverProfiles: [serverProfile()],
    chatModelProfiles: [chatProfile()],
  };
}

function createProberHost(settings: AttestSettings): AttestPlugin {
  return {
    settings,
    logger: new PluginDebugLogger({ getSettings: () => settings }),
    saveSettings: async () => {},
  } as unknown as AttestPlugin;
}

function createPlugin(app: App, settings: AttestSettings): AttestPlugin {
  const plugin = new AttestPluginClass(app as unknown as ObsidianApp, {
    id: "attest",
    name: "Attest",
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
    const tab = new AttestSettingTab(app as unknown as ObsidianApp, createPlugin(app, settings));
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
    const tab = new AttestSettingTab(app as unknown as ObsidianApp, createPlugin(app, settings));
    const prober = (tab as unknown as { prober: SettingsCapabilityProber }).prober;

    tab.display();
    tab.hide();
    prober.startChatProfileProbes("chat");

    expect(pendingTimerCount()).toBe(0);
  });

  it("caches discovered metadata only for active servers and persists it once", async () => {
    const settings = createSettings();
    settings.serverProfiles.push({ ...serverProfile(), id: "suspended", isSuspended: true });
    let saves = 0;
    const models = new Map();
    const prober = new SettingsCapabilityProber({
      plugin: {
        ...createProberHost(settings),
        saveSettings: async () => {
          saves += 1;
        },
      } as AttestPlugin,
      fetchedModelsByServerId: models,
      requestRedisplay: () => {},
    });
    const snapshot = {
      reasoning: { visibleOutput: "unknown", responseFormats: [] },
      source: "metadata",
      checkedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
    };
    vi.mocked(fetchAvailableModels).mockResolvedValueOnce({
      models: [
        {
          id: "discovered",
          name: "Discovered",
          capabilities: { chat: true, embeddings: false, detectionSource: "metadata" },
          capabilitySnapshot: snapshot as never,
        },
      ],
      ok: true,
      message: "ok",
    });

    await prober.refreshMetadataCapabilities();

    expect(models.get("server")).toEqual([
      expect.objectContaining({ id: "discovered", capabilitySnapshot: snapshot }),
    ]);
    expect(models.has("suspended")).toBe(false);
    expect(Object.values(settings.modelCapabilityCache)).toHaveLength(2);
    expect(saves).toBe(1);
  });

  it("restores an embedding profile after its capability probe succeeds", async () => {
    const settings = createSettings();
    settings.embeddingModelProfiles = [
      {
        id: "embedding",
        name: "Embedding",
        serverProfileId: "server",
        modelName: "embed-model",
        isSuspended: true,
        suspendedReason: "Embedding capability could not be verified.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as never,
    ];
    let saves = 0;
    const prober = new SettingsCapabilityProber({
      plugin: {
        ...createProberHost(settings),
        saveSettings: async () => {
          saves += 1;
        },
      } as AttestPlugin,
      fetchedModelsByServerId: new Map(),
      requestRedisplay: () => {},
    });
    vi.spyOn(settingsApi, "verifyEmbeddingCapability").mockResolvedValueOnce(true);

    prober.startEmbeddingProfileProbe("embedding");
    await vi.waitFor(() => expect(saves).toBe(1));

    expect(settings.embeddingModelProfiles[0]).toMatchObject({
      isSuspended: false,
      suspendedReason: undefined,
      capabilities: { embeddings: true, detectionSource: "probe" },
    });
  });
});
