import { describe, expect, it, vi } from "vitest";

import { TFile } from "obsidian";

import { ObsidianContextFileProvider } from "@adapters/obsidian/ObsidianContextFileProvider";

function file(path: string, size = 10, mtime = 100): TFile {
  return Object.assign(Object.create(TFile.prototype), { path, stat: { size, mtime, ctime: 0 } });
}

describe("ObsidianContextFileProvider", () => {
  it("lists only supported context documents in normalized lexical order", async () => {
    const vault = {
      getFiles: vi.fn(() => [
        file("Books/Novel.EPUB"),
        file("Notes\\Plan.md"),
        file("Images/diagram.png"),
        file("Archive/data.zip"),
        file("Notes/Appendix.PDF"),
      ]),
    };

    await expect(new ObsidianContextFileProvider(vault as never).listPaths()).resolves.toEqual([
      "Books/Novel.EPUB",
      "Notes/Appendix.PDF",
      "Notes/Plan.md",
    ]);
  });

  it("reads a resolved file and returns safe defaults for paths removed from the vault", async () => {
    const note = file("Notes/plan.md", 42, 123);
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const vault = {
      getAbstractFileByPath: vi.fn((path: string) => (path === note.path ? note : null)),
      readBinary: vi.fn().mockResolvedValue(bytes),
    };
    const provider = new ObsidianContextFileProvider(vault as never);

    await expect(provider.readFile(note.path)).resolves.toBe(bytes);
    await expect(provider.readFile("Notes/deleted.md")).resolves.toBe("");
    await expect(provider.getModifiedTime(note.path)).resolves.toBe(123);
    await expect(provider.getModifiedTime("Notes/deleted.md")).resolves.toBe(0);
    await expect(provider.getSize(note.path)).resolves.toBe(42);
    await expect(provider.getSize("Notes/deleted.md")).resolves.toBe(0);
    expect(vault.readBinary).toHaveBeenCalledOnce();
  });
});
