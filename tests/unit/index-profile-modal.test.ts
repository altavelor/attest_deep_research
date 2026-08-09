// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, takeNotices } from "../stubs/obsidian";

import { createTranslator } from "@adapters/i18n";
import { DEFAULT_INDEX_PROFILE } from "@adapters/settings";
import type { EmbeddingModelProfile } from "@adapters/settings";
import { IndexProfileModal } from "@apps/obsidian/ui/settings/IndexProfileModal";
import type { App as ObsidianApp } from "obsidian";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

const embeddingModel: EmbeddingModelProfile = {
  id: "embedding",
  name: "Embeddings",
  serverProfileId: "server",
  modelName: "text-embedding-3-small",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function inputFor(container: HTMLElement, name: string): HTMLInputElement {
  const setting = Array.from(container.querySelectorAll(".setting-item")).find(
    (item) => item.firstElementChild?.textContent === name,
  );
  expect(setting).toBeDefined();
  const input = setting!.querySelector<HTMLInputElement>("input");
  expect(input).not.toBeNull();
  return input!;
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent === "Save",
  );
  expect(button).toBeDefined();
  return button!;
}

describe("IndexProfileModal", () => {
  beforeEach(installObsidianDomHelpers);

  afterEach(() => {
    resetDom();
    vi.restoreAllMocks();
  });

  it("uses an available default embedding model and saves normalized index settings", async () => {
    const onSave = vi.fn(async () => {});
    const modal = new IndexProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profiles: [],
      embeddingModels: [embeddingModel],
      defaultEmbeddingModelProfileId: embeddingModel.id,
      onSave,
    });
    modal.open();

    inputFor(modal.contentEl, "Name").value = "  Research index  ";
    inputFor(modal.contentEl, "Name").dispatchEvent(new Event("input"));
    inputFor(modal.contentEl, "Chunk size").value = "200";
    inputFor(modal.contentEl, "Chunk size").dispatchEvent(new Event("input"));
    inputFor(modal.contentEl, "Chunk overlap").value = "500";
    inputFor(modal.contentEl, "Chunk overlap").dispatchEvent(new Event("input"));
    saveButton(modal.contentEl).click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Research index",
        mode: "wholeVault",
        includeFolders: ["/"],
        embeddingModelProfileId: "embedding",
        chunkSize: 200,
        chunkOverlap: 199,
      }),
    );
  });

  it("reports invalid input and tells users when an edited index must be rebuilt", async () => {
    const onSave = vi.fn(async () => {});
    const profile = {
      ...DEFAULT_INDEX_PROFILE,
      id: "research",
      name: "Research",
      embeddingModelProfileId: embeddingModel.id,
      lastIndexedAt: "2026-08-01T00:00:00.000Z",
    };
    const modal = new IndexProfileModal(new App() as unknown as ObsidianApp, {
      t,
      profile,
      profiles: [profile],
      embeddingModels: [embeddingModel],
      onSave,
    });
    modal.open();

    inputFor(modal.contentEl, "Name").value = "";
    inputFor(modal.contentEl, "Name").dispatchEvent(new Event("input"));
    saveButton(modal.contentEl).click();
    expect(takeNotices().map((notice) => notice.message)).toContain(
      "Use a unique name up to 60 characters with letters, numbers, spaces, _, -, ., (, ), [, ].",
    );

    inputFor(modal.contentEl, "Name").value = "Research";
    inputFor(modal.contentEl, "Name").dispatchEvent(new Event("input"));
    inputFor(modal.contentEl, "PDF chunk size").value = "300";
    inputFor(modal.contentEl, "PDF chunk size").dispatchEvent(new Event("input"));
    saveButton(modal.contentEl).click();

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(takeNotices().map((notice) => notice.message)).toContain(
      "Index settings changed. Rebuild this index to apply the new configuration.",
    );
  });
});
