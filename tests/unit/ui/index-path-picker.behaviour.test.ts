// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "../../stubs/obsidian";

import { IndexPathPickerModal } from "@apps/obsidian/ui/settings/IndexPathPickerModal";
import { installObsidianDomHelpers, resetDom } from "../../helpers/domHarness";

class NamedFile extends TFile {
  constructor(
    path: string,
    readonly name: string,
  ) {
    super(path);
  }
}

class NamedFolder extends TFolder {
  constructor(
    path: string,
    readonly name: string,
  ) {
    super(path);
  }
}

function vaultApp(): App {
  const root = new NamedFolder("", "");
  const notes = new NamedFolder("notes", "notes");
  const nested = Array.from(
    { length: 6 },
    (_, index) => new NamedFile(`notes/nested-${index}.md`, `nested-${index}.md`),
  );
  const topLevel = Array.from(
    { length: 12 },
    (_, index) => new NamedFile(`note-${index}.md`, `note-${index}.md`),
  );
  notes.children = nested;
  root.children = [notes, ...topLevel];
  const all = [...nested, ...topLevel];
  const byPath = new Map<string, TFile | TFolder>([
    ["notes", notes],
    ...all.map((file) => [file.path, file] as [string, TFile]),
  ]);
  return {
    vault: {
      getRoot: () => root,
      getAllLoadedFiles: () => [notes, ...all],
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
    },
  } as unknown as App;
}

/**
 * Emulates the browser behaviour the picker compensates for: a scroll container
 * loses its offset the moment its content is removed, so a rerender that does
 * not restore the offset lands back at the top.
 */
function resetScrollWhenEmptied(element: HTMLElement): void {
  let scrollTop = 0;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  const empty = element.empty.bind(element);
  Object.defineProperty(element, "empty", {
    configurable: true,
    value: () => {
      scrollTop = 0;
      empty();
    },
  });
}

function openPicker(onSubmit = vi.fn()) {
  const modal = new IndexPathPickerModal(vaultApp(), { selectedPaths: [], onSubmit });
  modal.open();
  const treeEl = modal.contentEl.querySelector<HTMLElement>(".ixplorer-index-path-picker");
  if (!treeEl) throw new Error("The picker did not render its tree.");
  resetScrollWhenEmptied(treeEl);
  return { modal, treeEl, onSubmit };
}

function checkboxFor(treeEl: HTMLElement, path: string): HTMLInputElement {
  const checkbox = treeEl.querySelector<HTMLInputElement>(`input[aria-label="Select ${path}"]`);
  if (!checkbox) throw new Error(`No checkbox for "${path}".`);
  return checkbox;
}

beforeEach(() => {
  installObsidianDomHelpers();
});

afterEach(() => {
  resetDom();
});

describe("index path picker scroll position", () => {
  it("keeps the scroll offset when selecting a path rerenders the tree", () => {
    const { treeEl, modal } = openPicker();
    treeEl.scrollTop = 180;

    const checkbox = checkboxFor(treeEl, "note-7.md");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    expect(treeEl.scrollTop).toBe(180);
    expect(checkboxFor(treeEl, "note-7.md").checked).toBe(true);
    expect(checkboxFor(treeEl, "note-6.md").checked).toBe(false);
    modal.close();
  });

  it("keeps the scroll offset when expanding a folder rerenders the tree", () => {
    const { treeEl, modal } = openPicker();
    treeEl.scrollTop = 90;

    treeEl.querySelector<HTMLButtonElement>('button[aria-label="Toggle notes"]')?.click();

    expect(treeEl.scrollTop).toBe(90);
    expect(treeEl.querySelectorAll(".ixplorer-index-path-picker__row").length).toBeGreaterThan(13);
    modal.close();
  });

  it("returns to the top when a new search query replaces the tree", () => {
    const { treeEl, modal } = openPicker();
    treeEl.scrollTop = 200;

    const search = modal.contentEl.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error("The picker did not render its search field.");
    search.value = "note-1";
    search.dispatchEvent(new Event("input"));

    expect(treeEl.scrollTop).toBe(0);
    modal.close();
  });

  it("submits the selection made across rerenders", () => {
    const { treeEl, modal, onSubmit } = openPicker();

    checkboxFor(treeEl, "note-2.md").click();
    checkboxFor(treeEl, "note-5.md").click();
    modal.contentEl.querySelectorAll<HTMLButtonElement>("button.mod-cta").forEach((button) => {
      button.click();
    });

    expect(onSubmit).toHaveBeenCalledWith(["note-2.md", "note-5.md"]);
  });
});
