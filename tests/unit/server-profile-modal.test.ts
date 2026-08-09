// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, takeNotices } from "../stubs/obsidian";

import { createTranslator } from "@adapters/i18n";
import type { ServerProfile } from "@adapters/settings";
import { ServerProfileModal } from "@apps/obsidian/ui/settings/ServerProfileModal";
import type { App as ObsidianApp } from "obsidian";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

function inputFor(container: HTMLElement, name: string): HTMLInputElement {
  const setting = Array.from(container.querySelectorAll(".setting-item")).find(
    (item) => item.firstElementChild?.textContent === name,
  );
  return setting!.querySelector<HTMLInputElement>("input")!;
}

function save(container: HTMLElement): void {
  Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "Save")!
    .click();
}

describe("ServerProfileModal", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(() => {
    resetDom();
    vi.restoreAllMocks();
  });

  it("normalizes server input and preserves optional credentials only when provided", async () => {
    const onSave = vi.fn(async () => {});
    const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [],
      onSave,
    });
    modal.open();
    for (const [name, value] of [
      ["Name", " Personal API "],
      ["Base URL", " https://api.example.test/v1/// "],
      ["API key", " secret "],
    ]) {
      const input = inputFor(modal.contentEl, name);
      input.value = value;
      input.dispatchEvent(new Event("input"));
    }
    const format = modal.contentEl.querySelector<HTMLSelectElement>("select")!;
    format.value = "anthropic";
    format.dispatchEvent(new Event("change"));
    save(modal.contentEl);

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Personal API",
        apiFormat: "anthropic",
        baseUrl: "https://api.example.test/v1",
        apiKey: "secret",
      }),
    );
  });

  it("rejects missing, invalid, and duplicate names before saving", () => {
    const existing: ServerProfile = {
      id: "existing",
      name: "Existing",
      apiFormat: "openai-compatible",
      baseUrl: "https://example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const onSave = vi.fn(async () => {});
    const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [existing],
      onSave,
    });
    modal.open();
    save(modal.contentEl);
    expect(takeNotices()[0]?.message).toBe("Fill all required fields.");

    const name = inputFor(modal.contentEl, "Name");
    name.value = "Existing";
    name.dispatchEvent(new Event("input"));
    const url = inputFor(modal.contentEl, "Base URL");
    url.value = "https://example.test";
    url.dispatchEvent(new Event("input"));
    save(modal.contentEl);
    expect(takeNotices()[0]?.message).toBe("Name must be unique.");
    expect(onSave).not.toHaveBeenCalled();
  });
});
