// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, takeNotices } from "../stubs/obsidian";

import { createTranslator } from "@adapters/i18n";
import type { ServerProfile } from "@adapters/settings";
import { ServerProfileModal } from "@apps/obsidian/ui/settings/ServerProfileModal";
import type { App as ObsidianApp } from "obsidian";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

function settingFor(container: HTMLElement, name: string): HTMLElement {
  return Array.from(container.querySelectorAll<HTMLElement>(".setting-item")).find(
    (item) => item.firstElementChild?.textContent === name,
  )!;
}

function inputFor(container: HTMLElement, name: string): HTMLInputElement {
  return settingFor(container, name).querySelector<HTMLInputElement>("input")!;
}

function selectFor(container: HTMLElement, name: string): HTMLSelectElement {
  return settingFor(container, name).querySelector<HTMLSelectElement>("select")!;
}

function choose(container: HTMLElement, name: string, value: string): void {
  const select = selectFor(container, name);
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

function type(container: HTMLElement, name: string, value: string): void {
  const input = inputFor(container, name);
  input.value = value;
  input.dispatchEvent(new Event("input"));
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
    choose(modal.contentEl, "API format", "anthropic");
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

  it("fills the endpoint from a provider preset and suggests its name", async () => {
    const onSave = vi.fn(async () => {});
    const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [],
      onSave,
    });
    modal.open();
    choose(modal.contentEl, "Provider", "anthropic");

    expect(inputFor(modal.contentEl, "Base URL").value).toBe("https://api.anthropic.com/v1");
    expect(selectFor(modal.contentEl, "API format").value).toBe("anthropic");
    expect(inputFor(modal.contentEl, "Name").value).toBe("Anthropic");

    save(modal.contentEl);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Anthropic",
        apiFormat: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
      }),
    );
  });

  it("keeps a name the user already typed and applies the local Ollama preset", () => {
    const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [],
      onSave: vi.fn(async () => {}),
    });
    modal.open();
    type(modal.contentEl, "Name", "My box");
    choose(modal.contentEl, "Provider", "ollama");

    expect(inputFor(modal.contentEl, "Name").value).toBe("My box");
    expect(inputFor(modal.contentEl, "Base URL").value).toBe("http://localhost:11434");
    expect(selectFor(modal.contentEl, "API format").value).toBe("ollama");
  });

  it("leaves every field untouched when Custom is selected", () => {
    const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [],
      onSave: vi.fn(async () => {}),
    });
    modal.open();
    type(modal.contentEl, "Base URL", "https://self.hosted.test/v1");
    choose(modal.contentEl, "Provider", "custom");

    expect(inputFor(modal.contentEl, "Base URL").value).toBe("https://self.hosted.test/v1");
    expect(inputFor(modal.contentEl, "Name").value).toBe("");
  });

  it("reopens a saved profile with its provider preselected, and unknown URLs as custom", () => {
    const openWith = (baseUrl: string): HTMLElement => {
      const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
        t,
        profiles: [],
        profile: {
          id: "p",
          name: "Saved",
          apiFormat: "openai-compatible",
          baseUrl,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        onSave: vi.fn(async () => {}),
      });
      modal.open();
      return modal.contentEl;
    };

    expect(selectFor(openWith("https://api.groq.com/openai/v1/"), "Provider").value).toBe("groq");
    expect(selectFor(openWith("https://self.hosted.test/v1"), "Provider").value).toBe("custom");
  });

  it("still fills fields after the modal is closed and reopened", () => {
    const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [],
      onSave: vi.fn(async () => {}),
    });
    modal.open();
    modal.close();
    modal.open();
    choose(modal.contentEl, "Provider", "groq");

    expect(inputFor(modal.contentEl, "Base URL").value).toBe("https://api.groq.com/openai/v1");
    expect(selectFor(modal.contentEl, "API format").value).toBe("openai-compatible");
    expect(inputFor(modal.contentEl, "Name").value).toBe("Groq");
  });

  it("replaces a name that came from the previously chosen preset", () => {
    const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [],
      onSave: vi.fn(async () => {}),
    });
    modal.open();
    choose(modal.contentEl, "Provider", "openai");
    choose(modal.contentEl, "Provider", "groq");

    expect(inputFor(modal.contentEl, "Name").value).toBe("Groq");
    expect(inputFor(modal.contentEl, "Base URL").value).toBe("https://api.groq.com/openai/v1");
  });

  it("switches the endpoint of a saved profile while keeping its own name", async () => {
    const onSave = vi.fn(async () => {});
    const modal = new ServerProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [],
      profile: {
        id: "p",
        name: "Work key",
        apiFormat: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      onSave,
    });
    modal.open();
    choose(modal.contentEl, "Provider", "groq");
    save(modal.contentEl);

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Work key",
        baseUrl: "https://api.groq.com/openai/v1",
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
