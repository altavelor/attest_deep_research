// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, takeNotices } from "../../stubs/obsidian";
import type { App as ObsidianApp } from "obsidian";

import { DEFAULT_SETTINGS } from "@adapters/settings";
import type { AttestSettings } from "@adapters/settings";
import { createTranslator } from "@adapters/i18n";
import type { WebSourceActivation } from "@core/web";
import { WebSourcesSection } from "@apps/obsidian/ui/settings/WebSourcesSection";
import { WebSourceModal } from "@apps/obsidian/ui/settings/WebSourceModal";
import { findWebSourceDescriptor } from "@core/web";
import type { WebSourceProfile } from "@core/web";
import {
  installObsidianDomHelpers,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";

const t = createTranslator("en").t;

function settingsWith(activation: WebSourceActivation): AttestSettings {
  return {
    ...DEFAULT_SETTINGS,
    webSources: [{ sourceId: "duckduckgo", activation, credentials: {} }],
  };
}

function render(settings: AttestSettings, save: () => Promise<void> = async () => {}) {
  const saveSettings = vi.fn(save);
  const requestRedisplay = vi.fn();
  const section = new WebSourcesSection({
    app: new App() as unknown as ObsidianApp,
    t,
    getSettings: () => settings,
    saveSettings,
    requestRedisplay,
    getSourceIssue: () => undefined,
    resetSourceIssue: () => {},
  });
  const container = document.createElement("div");
  section.render(container);
  return { container, saveSettings, requestRedisplay };
}

function lampFor(container: HTMLElement, sourceId: string): HTMLElement {
  const rows = Array.from(container.querySelectorAll(".attest-settings-websource-list__item"));
  const row = rows.find((candidate) => candidate.textContent?.includes("DuckDuckGo"));
  expect(row, `no row for ${sourceId}`).toBeDefined();
  const lamp = row!.querySelector<HTMLElement>(".attest-settings-websource-lamp");
  expect(lamp).not.toBeNull();
  return lamp!;
}

function activationOf(settings: AttestSettings): WebSourceActivation | undefined {
  return settings.webSources.find((profile) => profile.sourceId === "duckduckgo")?.activation;
}

describe("WebSourcesSection activation lamp", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    useDomFakeTimers();
  });

  afterEach(() => {
    takeNotices();
    restoreDomTimers();
    resetDom();
    vi.restoreAllMocks();
  });

  it.each([
    ["off", "auto"],
    ["auto", "always"],
    ["always", "off"],
  ] as const)("cycles %s → %s on click and persists", async (from, to) => {
    const settings = settingsWith(from);
    const { container, saveSettings, requestRedisplay } = render(settings);

    lampFor(container, "duckduckgo").click();
    await vi.waitFor(() => {
      expect(activationOf(settings)).toBe(to);
      expect(requestRedisplay).toHaveBeenCalledTimes(1);
    });

    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("returns to the starting state after three clicks", async () => {
    const settings = settingsWith("off");

    for (const expected of ["auto", "always", "off"] as const) {
      const { container } = render(settings);
      lampFor(container, "duckduckgo").click();
      await vi.waitFor(() => expect(activationOf(settings)).toBe(expected));
    }
  });

  it("rolls back the activation and reports a failed save", async () => {
    const settings = settingsWith("off");
    const { container, requestRedisplay } = render(settings, async () => {
      throw new Error("disk full");
    });

    lampFor(container, "duckduckgo").click();
    await vi.waitFor(() => expect(requestRedisplay).toHaveBeenCalledTimes(1));

    expect(activationOf(settings)).toBe("off");
    expect(takeNotices()).toHaveLength(1);
  });

  it("serializes rapid activation changes so a failed save cannot restore stale state", async () => {
    const settings = settingsWith("off");
    let rejectFirst: ((reason: Error) => void) | undefined;
    const save = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const { container } = render(settings, save);
    const lamp = lampFor(container, "duckduckgo");

    lamp.click();
    lamp.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    rejectFirst!(new Error("first save failed"));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(activationOf(settings)).toBe("auto");
  });

  it("marks each state distinctly and names the next one in the label", () => {
    const off = lampFor(render(settingsWith("off")).container, "duckduckgo");
    const auto = lampFor(render(settingsWith("auto")).container, "duckduckgo");
    const always = lampFor(render(settingsWith("always")).container, "duckduckgo");

    expect(off.className).toContain("is-off");
    expect(auto.className).toContain("is-on");
    expect(auto.className).not.toContain("is-always");
    expect(always.className).toContain("is-always");

    expect(off.getAttribute("aria-label")).toContain("Auto");
    expect(auto.getAttribute("aria-label")).toContain("Always");
    expect(always.getAttribute("aria-label")).toContain("Off");
  });

  it("counts every non-off source as enabled in the section header", () => {
    const enabled = (settings: AttestSettings) =>
      render(settings).container.textContent?.match(/(\d+) of \d+ enabled/)?.[1] ??
      render(settings).container.textContent;

    expect(enabled(settingsWith("off"))).toBe("0");
    expect(enabled(settingsWith("auto"))).toBe("1");
    expect(enabled(settingsWith("always"))).toBe("1");
  });
});

describe("WebSourceModal activation gating", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
    useDomFakeTimers();
  });

  afterEach(() => {
    restoreDomTimers();
    resetDom();
    vi.restoreAllMocks();
  });

  async function save(
    profile: WebSourceProfile,
    credentials: Record<string, string>,
  ): Promise<WebSourceProfile> {
    const descriptor = findWebSourceDescriptor("brave");
    expect(descriptor).toBeDefined();
    const saved: WebSourceProfile[] = [];
    const modal = new WebSourceModal(new App() as unknown as ObsidianApp, {
      t,
      descriptor: descriptor!,
      profile,
      onSave: async (next) => {
        saved.push(next);
      },
    });

    modal.onOpen();
    for (const [key, value] of Object.entries(credentials)) {
      (modal as unknown as { credentials: Record<string, string> }).credentials[key] = value;
    }
    await (modal as unknown as { save(): Promise<void> }).save();

    expect(saved).toHaveLength(1);
    return saved[0];
  }

  it("keeps the chosen activation once required credentials are present", async () => {
    const saved = await save(
      { sourceId: "brave", activation: "always", credentials: {} },
      { apiKey: "k" },
    );

    expect(saved).toMatchObject({ activation: "always", credentials: { apiKey: "k" } });
  });

  it("forces the source off when a required credential is missing", async () => {
    const saved = await save(
      { sourceId: "brave", activation: "always", credentials: { apiKey: "k" } },
      { apiKey: "" },
    );

    expect(saved.activation).toBe("off");
  });
});
