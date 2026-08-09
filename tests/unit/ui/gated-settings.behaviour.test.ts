// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";

import { DEFAULT_SETTINGS } from "@adapters/settings";
import { createTranslator } from "@adapters/i18n";
import { WebSourceHealthTracker } from "@application/web";
import { RetrievalSettingsSection } from "@apps/obsidian/ui/settings/RetrievalSettingsSection";
import { createContainer, resetDom } from "../../helpers/domHarness";

function render(host: HTMLElement, hasActiveChatModel: boolean): void {
  new RetrievalSettingsSection({
    app: new App(),
    t: createTranslator("en").t,
    settings: structuredClone(DEFAULT_SETTINGS),
    webSourceHealth: new WebSourceHealthTracker(),
    hasActiveChatModel,
    saveSettings: async () => {},
    requestRedisplay: () => {},
  }).render(host);
}

let container: HTMLElement;

beforeEach(() => {
  container = createContainer();
});

afterEach(() => {
  resetDom();
});

describe("retrieval settings gated behind a chat model profile", () => {
  it("marks the gated content as disabled and inert for assistive technology", () => {
    render(container, false);

    const gated = container.querySelector<HTMLElement>(".ixplorer-settings__gated-content");
    expect(gated).not.toBeNull();
    expect(gated?.getAttribute("aria-disabled")).toBe("true");
    expect(gated?.hasAttribute("inert")).toBe(true);
    expect(container.textContent).toContain("Add a chat model profile first");
    expect(gated?.textContent).toContain("Retrieval");
  });

  it("renders the settings ungated once a chat model profile exists", () => {
    render(container, true);

    expect(container.querySelector(".ixplorer-settings__gated-content")).toBeNull();
    expect(container.querySelector("[inert]")).toBeNull();
    expect(container.textContent).toContain("Retrieval");
  });
});
