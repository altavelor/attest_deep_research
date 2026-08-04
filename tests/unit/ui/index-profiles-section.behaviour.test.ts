// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { App } from "obsidian";
import type { IndexProfile } from "@adapters/indexing";
import { DEFAULT_INDEX_PROFILE, DEFAULT_SETTINGS, cloneIndexProfile } from "@adapters/settings";
import type { IxplorerSettings } from "@adapters/settings";
import type IxplorerPlugin from "@apps/obsidian/main";
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

function starButton(row: HTMLElement): HTMLButtonElement {
  return row.querySelector<HTMLButtonElement>(".ixplorer-settings__default-action")!;
}

function settingsWith(profiles: IndexProfile[], activeId: string): IxplorerSettings {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: profiles,
    activeIndexProfileId: activeId,
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

  it("marks no row as default when the active profile id refers to a missing profile", () => {
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
    expect(starButton(row).getAttribute("aria-label")).toBe("Set as default index");
    expect(starButton(row).disabled).toBe(false);
    section.dispose();
  });

  it("renders a suspended profile with its reason and blocks the default and run actions", () => {
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
    expect(starButton(row).disabled).toBe(true);
    expect(
      row.querySelector<HTMLButtonElement>('button[aria-label="Update index"]')?.disabled,
    ).toBe(true);
    section.dispose();
  });

  it("keeps the default action disabled for a profile that was never indexed", () => {
    const { container, section } = render(
      settingsWith([indexProfile({ id: "a", name: "Alpha" })], "other"),
    );

    const [row] = rows(container);
    expect(row.querySelector('button[aria-label="Start indexing"]')).not.toBeNull();
    expect(starButton(row).disabled).toBe(true);
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

  it("marks exactly the active profile as the default index", () => {
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
    expect(statuses).toEqual([null, "Default"]);
    section.dispose();
  });
});
