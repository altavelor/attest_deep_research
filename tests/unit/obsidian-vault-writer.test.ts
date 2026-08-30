import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";

import { ObsidianVaultWriter } from "@adapters/obsidian/ObsidianVaultWriter";
import type { App } from "obsidian";

function file(path: string): TFile {
  return Object.assign(new TFile(), { path });
}

function folder(path: string): TFolder {
  return Object.assign(new TFolder(), { path });
}

function app(existing: TFile | null = null): App {
  return {
    vault: {
      getAbstractFileByPath: vi.fn(() => existing),
      modify: vi.fn(async () => {}),
      create: vi.fn(async () => {}),
      modifyBinary: vi.fn(async () => {}),
      createBinary: vi.fn(async () => {}),
      append: vi.fn(async () => {}),
      read: vi.fn(async () => "content"),
      trash: vi.fn(async () => {}),
      createFolder: vi.fn(async () => {}),
    },
  } as unknown as App;
}

describe("ObsidianVaultWriter", () => {
  it("updates existing text and binary files instead of creating duplicates", async () => {
    const existing = file("Notes/existing.md");
    const fakeApp = app(existing);
    const writer = new ObsidianVaultWriter(fakeApp);

    await writer.createFile(existing.path, "updated");
    await writer.createBinaryFile(existing.path, Uint8Array.from([1, 2]));

    expect(await writer.exists(existing.path)).toBe(true);
    expect(fakeApp.vault.modify).toHaveBeenCalledWith(existing, "updated");
    expect(fakeApp.vault.modifyBinary).toHaveBeenCalledWith(existing, expect.any(ArrayBuffer));
    expect(fakeApp.vault.create).not.toHaveBeenCalled();
    expect(fakeApp.vault.createBinary).not.toHaveBeenCalled();
  });

  it("creates missing files and folders and rejects destructive operations on missing paths", async () => {
    const fakeApp = app();
    const writer = new ObsidianVaultWriter(fakeApp);

    await writer.createFile("Notes/new.md", "new");
    await writer.createBinaryFile("Notes/image.png", Uint8Array.from([3]));
    await writer.ensureFolder("Notes");

    expect(await writer.exists("Notes/new.md")).toBe(false);
    expect(fakeApp.vault.create).toHaveBeenCalledWith("Notes/new.md", "new");
    expect(fakeApp.vault.createBinary).toHaveBeenCalledWith(
      "Notes/image.png",
      expect.any(ArrayBuffer),
    );
    expect(fakeApp.vault.createFolder).toHaveBeenCalledWith("Notes");
    await expect(writer.appendFile("Notes/missing.md", "text")).rejects.toThrow(
      "File not found: Notes/missing.md",
    );
    await expect(writer.trashFile("Notes/missing.md")).rejects.toThrow(
      "File not found: Notes/missing.md",
    );
  });

  it("reads, modifies, appends, and trashes an existing file", async () => {
    const existing = file("Notes/existing.md");
    const fakeApp = app(existing);
    const writer = new ObsidianVaultWriter(fakeApp);

    await writer.modifyFile(existing.path, "replacement");
    await writer.appendFile(existing.path, "\nnext");
    await expect(writer.readFile(existing.path)).resolves.toBe("content");
    await writer.trashFile(existing.path);
    await writer.ensureFolder("");
    fakeApp.vault.getAbstractFileByPath = vi.fn(() => folder("Notes")) as never;
    await writer.ensureFolder("Notes");

    expect(fakeApp.vault.modify).toHaveBeenCalledWith(existing, "replacement");
    expect(fakeApp.vault.append).toHaveBeenCalledWith(existing, "\nnext");
    expect(fakeApp.vault.read).toHaveBeenCalledWith(existing);
    expect(fakeApp.vault.trash).toHaveBeenCalledWith(existing, true);
    expect(fakeApp.vault.createFolder).not.toHaveBeenCalled();
  });
});
