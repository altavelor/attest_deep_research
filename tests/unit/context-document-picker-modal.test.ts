// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "../stubs/obsidian";

import { createTranslator } from "@adapters/i18n";
import { ContextDocumentPickerModal } from "@apps/obsidian/ui/chat/context/ContextDocumentPickerModal";
import type { App as ObsidianApp } from "obsidian";
import type { TFile as ObsidianTFile } from "obsidian";
import { installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

function file(path: string): ObsidianTFile {
  return Object.assign(new TFile(path), {
    path,
    name: path.split("/").at(-1)!,
  }) as unknown as ObsidianTFile;
}

function item(container: HTMLElement, label: string): HTMLInputElement {
  const row = Array.from(container.querySelectorAll("label")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  expect(row).toBeDefined();
  return row!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

describe("ContextDocumentPickerModal", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("replaces selected descendants with a folder attachment and disables covered files", () => {
    const onSubmit = vi.fn();
    const modal = new ContextDocumentPickerModal(new App() as unknown as ObsidianApp, {
      files: [file("Notes/first.md"), file("Notes/Nested/second.pdf"), file("readme.md")],
      selectedPaths: ["Notes/first.md"],
      t,
      onSubmit,
    });
    modal.open();

    const notes = item(modal.contentEl, "Notes");
    expect(notes.checked).toBe(false);
    notes.checked = true;
    notes.dispatchEvent(new Event("change"));

    expect(item(modal.contentEl, "first.md")).toMatchObject({ checked: true, disabled: true });
    modal.contentEl.querySelector<HTMLButtonElement>("button.mod-cta")!.click();
    expect(onSubmit).toHaveBeenCalledWith(["Notes/"]);
  });

  it("filters paths and returns a file-level selection when no folder covers it", () => {
    const onSubmit = vi.fn();
    const modal = new ContextDocumentPickerModal(new App() as unknown as ObsidianApp, {
      files: [file("Notes/first.md"), file("Notes/Nested/second.pdf"), file("readme.md")],
      selectedPaths: [],
      t,
      onSubmit,
    });
    modal.open();

    const search = modal.contentEl.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "second";
    search.dispatchEvent(new Event("input"));
    expect(modal.contentEl.textContent).toContain("Notes/Nested/second.pdf");
    const second = item(modal.contentEl, "Notes/Nested/second.pdf");
    second.checked = true;
    second.dispatchEvent(new Event("change"));
    modal.contentEl.querySelector<HTMLButtonElement>("button.mod-cta")!.click();

    expect(onSubmit).toHaveBeenCalledWith(["Notes/Nested/second.pdf"]);
  });
});
