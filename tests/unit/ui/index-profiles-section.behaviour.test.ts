// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { App } from "obsidian";
import type { IndexProfile } from "@adapters/indexing";
import { DEFAULT_INDEX_PROFILE, DEFAULT_SETTINGS, cloneIndexProfile } from "@adapters/settings";
import type { IxplorerSettings } from "@adapters/settings";
import type IxplorerPlugin from "@apps/obsidian/main";
import { createTranslator } from "@adapters/i18n";
import { IndexProfilesSection } from "@apps/obsidian/ui/settings/IndexProfilesSection";
import { installObsidianDomHelpers, resetDom } from "../../helpers/domHarness";

function indexProfile(overrides: Partial<IndexProfile>): IndexProfile {
  return { ...cloneIndexProfile(DEFAULT_INDEX_PROFILE), isSuspended: false, ...overrides };
}

function indexingState() {
  return {
    status: "idle" as const,
    scannedFiles: 0,
    totalFiles: 0,
    progress: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    embeddedChunks: 0,
    deferredFiles: 0,
    failedFiles: 0,
    isStale: false,
  };
}

function enrichmentState() {
  return {
    status: "idle" as const,
    processed: 0,
    total: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
  };
}

function createPlugin(settings: IxplorerSettings): IxplorerPlugin {
  return {
    settings,
    translate: createTranslator("en").t,
    indexing: {
      getBusyProfileId: () => undefined,
      getState: () => indexingState(),
      subscribeAll: () => () => {},
    },
    enrichment: {
      getState: () => enrichmentState(),
      isRunning: () => false,
      subscribeAll: () => () => {},
    },
    saveSettings: async () => {},
  } as unknown as IxplorerPlugin;
}

function render(settings: IxplorerSettings): {
  container: HTMLElement;
  section: IndexProfilesSection;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const section = new IndexProfilesSection({} as unknown as App, createPlugin(settings), () => {});
  section.render(container);
  return { container, section };
}

function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".ixplorer-settings-index-list__item"));
}

function settingsWith(profiles: IndexProfile[], defaultIndexProfileId: string): IxplorerSettings {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: profiles,
    newChatDefaults: { ...DEFAULT_SETTINGS.newChatDefaults, indexProfileId: defaultIndexProfileId },
    embeddingModelProfiles: [],
    chatModelProfiles: [],
    serverProfiles: [],
  };
}

describe("index profiles section rendering", () => {
  beforeEach(() => {
    installObsidianDomHelpers();
  });

  afterEach(() => {
    resetDom();
    document.body.innerHTML = "";
  });

  it("renders no default badge or default action for an indexed profile", () => {
    const { container, section } = render(
      settingsWith(
        [
          indexProfile({
            id: "a",
            name: "Alpha",
            lastIndexedAt: "2026-01-02T00:00:00.000Z",
            indexVersion: 1,
          }),
        ],
        "does-not-exist",
      ),
    );

    const [row] = rows(container);
    expect(rows(container)).toHaveLength(1);
    expect(row.querySelector(".ixplorer-settings-profile-list__status")).toBeNull();
    expect(row.querySelector('button[aria-label="Set as default index"]')).toBeNull();
    section.dispose();
  });

  it("renders a suspended profile with its reason and blocks the run action", () => {
    const { container, section } = render(
      settingsWith(
        [
          indexProfile({
            id: "a",
            name: "Alpha",
            isSuspended: true,
            suspendedReason: "Select an embedding model profile.",
            lastIndexedAt: "2026-01-02T00:00:00.000Z",
            indexVersion: 1,
          }),
        ],
        "a",
      ),
    );

    const [row] = rows(container);
    const status = row.querySelector(".ixplorer-settings-profile-list__status");
    expect(status?.textContent).toBe("Suspended");
    expect(status?.getAttribute("title")).toBe("Select an embedding model profile.");
    expect(
      row.querySelector<HTMLButtonElement>('button[aria-label="Update index"]')?.disabled,
    ).toBe(true);
    section.dispose();
  });

  it("offers the start action for a profile that was never indexed", () => {
    const { container, section } = render(
      settingsWith([indexProfile({ id: "a", name: "Alpha" })], "other"),
    );

    const [row] = rows(container);
    expect(row.querySelector('button[aria-label="Start indexing"]')).not.toBeNull();
    section.dispose();
  });

  it("renders the table header but no rows when there is no profile at all", () => {
    const { container, section } = render(settingsWith([], "a"));

    expect(rows(container)).toHaveLength(0);
    expect(
      container.querySelector(".ixplorer-settings-profile-table__header")?.textContent,
    ).toContain("Status");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Add index profile"]')
        ?.disabled,
    ).toBe(false);
    section.dispose();
  });

  it("never marks a profile as the default index", () => {
    const { container, section } = render(
      settingsWith(
        [
          indexProfile({
            id: "a",
            name: "Alpha",
            lastIndexedAt: "2026-01-02T00:00:00.000Z",
            indexVersion: 1,
          }),
          indexProfile({
            id: "b",
            name: "Beta",
            lastIndexedAt: "2026-01-02T00:00:00.000Z",
            indexVersion: 1,
          }),
        ],
        "b",
      ),
    );

    const statuses = rows(container).map(
      (row) => row.querySelector(".ixplorer-settings-profile-list__status")?.textContent ?? null,
    );
    expect(statuses).toEqual([null, null]);
    section.dispose();
  });

  it("wires pause, resume, and metadata-stop actions to the active profile", () => {
    const settings = settingsWith([indexProfile({ id: "a", name: "Alpha" })], "a");
    const pause = vi.fn();
    const resume = vi.fn(async () => {});
    const cancel = vi.fn();
    const plugin = createPlugin(settings);
    const mutablePlugin = plugin as unknown as { indexing: unknown; enrichment: unknown };
    let mode: "indexing" | "paused" | "enrichment" = "indexing";
    mutablePlugin.indexing = {
      getBusyProfileId: () => "a",
      getState: () => ({
        ...indexingState(),
        status: mode === "paused" ? "paused" : mode === "indexing" ? "indexing" : "idle",
      }),
      subscribeAll: () => () => {},
      pause,
      resume,
    } as never;
    mutablePlugin.enrichment = {
      getState: () => ({
        ...enrichmentState(),
        status: mode === "enrichment" ? "running" : "idle",
      }),
      isRunning: () => mode === "enrichment",
      subscribeAll: () => () => {},
      cancel,
    } as never;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const section = new IndexProfilesSection({} as App, plugin, () => {});

    section.render(container);
    container.querySelector<HTMLButtonElement>('button[aria-label="Pause indexing"]')!.click();
    expect(pause).toHaveBeenCalledWith("a");

    mode = "paused";
    section.render(container);
    container.querySelector<HTMLButtonElement>('button[aria-label="Continue indexing"]')!.click();
    expect(resume).toHaveBeenCalledWith("a");

    mode = "enrichment";
    section.render(container);
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Stop metadata extraction"]')!
      .click();
    expect(cancel).toHaveBeenCalledWith("a");
    section.dispose();
  });
});
