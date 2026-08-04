// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, cloneIndexProfile } from "@adapters/settings";
import type {
  ChatModelProfile,
  IxplorerSettings,
  ServerProfile,
  ToolCapabilityProbeResult,
} from "@adapters/settings";
import { PluginDebugLogger } from "@adapters/settings";
import { SettingsCapabilityProber } from "@apps/obsidian/ui/settings/SettingsCapabilityProber";
import type IxplorerPlugin from "@apps/obsidian/main";
import { takeNotices } from "../../stubs/obsidian";
import {
  installObsidianDomHelpers,
  pendingTimerCount,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";

const probeToolControlCapabilities = vi.fn<[unknown], Promise<ToolCapabilityProbeResult>>();
const probeReasoningVisibility = vi.fn();
const inFlightProbes = new Set<Promise<unknown>>();

function trackProbe<T>(promise: Promise<T>): Promise<T> {
  inFlightProbes.add(promise);
  const forget = () => inFlightProbes.delete(promise);
  void promise.then(forget, forget);
  return promise;
}

vi.mock("@adapters/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/settings")>();
  return {
    ...actual,
    probeToolControlCapabilities: (options: unknown) =>
      trackProbe(probeToolControlCapabilities(options)),
    probeReasoningVisibility: (options: unknown) => trackProbe(probeReasoningVisibility(options)),
  };
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function toolProbeResult(calls: boolean): ToolCapabilityProbeResult {
  return {
    calls,
    choiceRequired: calls,
    choiceSpecific: calls,
    parallelCalls: false,
    probeAuditData: {
      ranAt: "2026-01-01T00:00:00.000Z",
      results: { required: [], specific: [], auto: [] },
    },
  };
}

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

interface Harness {
  prober: SettingsCapabilityProber;
  settings: IxplorerSettings;
  savedCount(): number;
  redisplayCount(): number;
  release(): void;
}

function createHarness(): Harness {
  const settings = createSettings();
  let saved = 0;
  let redisplays = 0;
  const plugin = {
    settings,
    logger: new PluginDebugLogger({ getSettings: () => settings }),
    saveSettings: async () => {
      saved += 1;
    },
  } as unknown as IxplorerPlugin;
  const prober = new SettingsCapabilityProber({
    plugin,
    fetchedModelsByServerId: new Map(),
    requestRedisplay: () => {
      redisplays += 1;
    },
  });
  const release = prober.subscribeAll(() => {});
  return {
    prober,
    settings,
    savedCount: () => saved,
    redisplayCount: () => redisplays,
    release,
  };
}

/** Awaits every launched probe and the follow-up handlers it schedules. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

function expectNoProbeInFlight(): void {
  expect(inFlightProbes.size).toBe(0);
}

describe("settings capability prober failure and race handling", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    useDomFakeTimers();
    inFlightProbes.clear();
    probeToolControlCapabilities.mockReset();
    probeReasoningVisibility.mockReset();
    probeReasoningVisibility.mockRejectedValue(new Error("reasoning probe unavailable"));
    takeNotices();
  });

  afterEach(async () => {
    await settle();
    expectNoProbeInFlight();
    expect(pendingTimerCount()).toBe(0);
    restoreDomTimers();
    resetDom();
    vi.restoreAllMocks();
  });

  it("marks tool capabilities failed and notifies the user when the probe rejects", async () => {
    const harness = createHarness();
    probeToolControlCapabilities.mockRejectedValue(new Error("probe exploded"));

    harness.prober.startChatProfileProbes("chat");
    expect(harness.prober.statusFor(harness.settings.chatModelProfiles[0]).tools).toBe("testing");

    await settle();

    expect(harness.prober.statusFor(harness.settings.chatModelProfiles[0]).tools).toBe("failed");
    expect(harness.settings.chatModelProfiles[0].capabilities).toBeUndefined();
    expect(harness.savedCount()).toBe(0);
    expect(
      takeNotices()
        .map((notice) => notice.message)
        .sort(),
    ).toEqual([
      "Capability detection failed for Chat.",
      "Tool capability detection failed for Chat.",
    ]);
    expectNoProbeInFlight();
    harness.release();
  });

  it("discards a probe result superseded by a model change while it was in flight", async () => {
    const harness = createHarness();
    const pending = deferred<ToolCapabilityProbeResult>();
    probeToolControlCapabilities.mockReturnValue(pending.promise);

    harness.prober.startChatProfileProbes("chat");
    harness.settings.chatModelProfiles[0].modelName = "another-model";

    pending.resolve(toolProbeResult(true));
    await settle();

    expect(harness.settings.chatModelProfiles[0].capabilities).toBeUndefined();
    expect(harness.savedCount()).toBe(0);
    expect(harness.redisplayCount()).toBe(0);
    expect(harness.prober.statusFor(harness.settings.chatModelProfiles[0]).tools).toBe(
      "not-tested",
    );
    expectNoProbeInFlight();
    harness.release();
  });

  it("applies the probe result when the profile is unchanged", async () => {
    const harness = createHarness();
    probeToolControlCapabilities.mockResolvedValue(toolProbeResult(true));

    harness.prober.startChatProfileProbes("chat");
    await settle();

    expect(harness.settings.chatModelProfiles[0].capabilities?.tools).toBe(true);
    expect(harness.savedCount()).toBe(1);
    expect(harness.prober.statusFor(harness.settings.chatModelProfiles[0]).tools).toBe("verified");
    expectNoProbeInFlight();
    harness.release();
  });

  it("stops notifying a released subscriber and leaves no pending timer behind", async () => {
    const harness = createHarness();
    const observed: string[] = [];
    const release = harness.prober.subscribeAll(() =>
      observed.push(harness.prober.statusFor(harness.settings.chatModelProfiles[0]).tools),
    );
    probeToolControlCapabilities.mockRejectedValue(new Error("probe exploded"));

    release();
    harness.prober.startChatProfileProbes("chat");
    await settle();

    expect(observed).toEqual([]);
    expect(pendingTimerCount()).toBe(0);
    expectNoProbeInFlight();
    harness.release();
  });

  it("ignores probe requests for an unknown profile or a suspended server", async () => {
    const harness = createHarness();

    harness.prober.startChatProfileProbes("missing");
    harness.settings.serverProfiles[0].isSuspended = true;
    harness.prober.startChatProfileProbes("chat");

    expect(probeToolControlCapabilities).not.toHaveBeenCalled();
    expectNoProbeInFlight();
    harness.release();
  });
});
