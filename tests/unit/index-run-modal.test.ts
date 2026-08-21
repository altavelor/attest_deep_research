// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../stubs/obsidian";

import { createTranslator } from "@adapters/i18n";
import { DEFAULT_INDEX_PROFILE } from "@adapters/settings";
import type { ChatModelProfile, EmbeddingModelProfile } from "@adapters/settings";
import { IndexRunModal } from "@apps/obsidian/ui/settings/IndexRunModal";
import type { App as ObsidianApp } from "obsidian";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

const embedding = (id: string): EmbeddingModelProfile => ({
  id,
  name: id,
  serverProfileId: "server",
  modelName: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const chat: ChatModelProfile = {
  id: "chat",
  name: "Chat",
  serverProfileId: "server",
  modelName: "chat-model",
  toolsEnabled: false,
  noteMutationAccess: false,
  reasoning: { mode: "off", summary: "off" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function setting(container: HTMLElement, name: string): HTMLElement {
  const setting = Array.from(container.querySelectorAll(".setting-item")).find(
    (item) => item.firstElementChild?.textContent === name,
  );
  expect(setting).toBeDefined();
  return setting! as HTMLElement;
}

function settingControl(container: HTMLElement, name: string): HTMLElement {
  return setting(container, name).lastElementChild! as HTMLElement;
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent === text,
  );
  expect(found).toBeDefined();
  return found!;
}

describe("IndexRunModal", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(() => {
    resetDom();
    vi.restoreAllMocks();
  });

  it("starts a new embedding run and prevents a no-op run", () => {
    const onSubmit = vi.fn();
    const modal = new IndexRunModal(new App() as unknown as ObsidianApp, {
      t,
      profile: { ...DEFAULT_INDEX_PROFILE, embeddingModelProfileId: "embedding-a" },
      hasMetadata: false,
      embeddingModels: [embedding("embedding-a")],
      chatModels: [chat],
      defaultChatModelProfileId: chat.id,
      onSubmit,
    });
    modal.open();

    button(modal.contentEl, "Start").click();
    expect(onSubmit).toHaveBeenCalledWith({
      mode: "start",
      embedding: { embeddingModelProfileId: "embedding-a" },
    });

    modal.open();
    const embeddingToggle = settingControl(
      modal.contentEl,
      "Index content (embedding model)",
    ).querySelector<HTMLInputElement>("input")!;
    embeddingToggle.click();
    expect(button(modal.contentEl, "Start").disabled).toBe(true);
    expect(
      settingControl(
        modal.contentEl,
        "Extract metadata & summaries (chat model)",
      ).querySelector<HTMLInputElement>("input")?.disabled,
    ).toBe(true);
  });

  it("turns an update into rebuild after an embedding-model change and preserves forced metadata extraction", () => {
    const onSubmit = vi.fn();
    const modal = new IndexRunModal(new App() as unknown as ObsidianApp, {
      t,
      profile: {
        ...DEFAULT_INDEX_PROFILE,
        embeddingModelProfileId: "embedding-a",
        lastIndexedAt: "2026-08-01T00:00:00.000Z",
      },
      hasMetadata: true,
      embeddingModels: [embedding("embedding-a"), embedding("embedding-b")],
      chatModels: [chat],
      defaultChatModelProfileId: chat.id,
      onSubmit,
    });
    modal.open();

    const modelSelect = settingControl(
      modal.contentEl,
      "Embedding model",
    ).querySelector<HTMLSelectElement>("select")!;
    modelSelect.value = "embedding-b";
    modelSelect.dispatchEvent(new Event("change"));
    expect(modal.contentEl.textContent).toContain(
      "Changing the embedding model requires a full re-index",
    );
    const reextract = settingControl(
      modal.contentEl,
      "Re-extract unchanged documents",
    ).querySelector<HTMLInputElement>("input")!;
    reextract.click();
    button(modal.contentEl, "Update").click();

    expect(onSubmit).toHaveBeenCalledWith({
      mode: "rebuild",
      embedding: { embeddingModelProfileId: "embedding-b" },
      metadata: { chatModelProfileId: "chat", force: true },
    });
  });

  it("requires a second explicit action before rebuilding on mobile", () => {
    const onSubmit = vi.fn();
    const modal = new IndexRunModal(new App() as unknown as ObsidianApp, {
      t,
      profile: {
        ...DEFAULT_INDEX_PROFILE,
        embeddingModelProfileId: "embedding-a",
        lastIndexedAt: "2026-08-01T00:00:00.000Z",
      },
      hasMetadata: false,
      embeddingModels: [embedding("embedding-a")],
      chatModels: [chat],
      defaultChatModelProfileId: chat.id,
      isMobile: true,
      onSubmit,
    });
    modal.open();

    button(modal.contentEl, "Rebuild").click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(modal.contentEl.textContent).toContain("Tap rebuild again to confirm");

    button(modal.contentEl, "Rebuild").click();
    expect(onSubmit).toHaveBeenCalledWith({
      mode: "rebuild",
      embedding: { embeddingModelProfileId: "embedding-a" },
    });
  });
});
