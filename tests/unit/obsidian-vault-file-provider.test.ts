import { describe, expect, it, vi } from "vitest";

import { TFile } from "obsidian";

import { ObsidianVaultFileProvider } from "@adapters/obsidian/ObsidianVaultFileProvider";

function file(path: string, size = 10, mtime = 100): TFile {
  return Object.assign(Object.create(TFile.prototype), { path, stat: { size, mtime, ctime: 0 } });
}

describe("ObsidianVaultFileProvider", () => {
  it("lists visible vault files while honoring Obsidian ignore filters", async () => {
    const visible = file("Notes/plan.md", 42, 123);
    const vault = {
      getFiles: vi.fn(() => [
        visible,
        file(".obsidian/config"),
        file("Archive/old.md"),
        file("Notes/.draft.md"),
      ]),
      getConfig: vi.fn(() => ["Archive/**", 7]),
    };

    await expect(new ObsidianVaultFileProvider(vault as never).listFiles()).resolves.toEqual([
      { path: "Notes/plan.md", size: 42, modifiedTime: 123 },
    ]);
    expect(vault.getConfig).toHaveBeenCalledWith("userIgnoreFilters");
  });

  it("tolerates a missing or malformed ignore configuration", async () => {
    const vault = {
      getFiles: vi.fn(() => [file("Notes/plan.md")]),
      getConfig: vi.fn(() => ({ invalid: true })),
    };

    await expect(new ObsidianVaultFileProvider(vault as never).listFiles()).resolves.toHaveLength(
      1,
    );
  });

  it("reads binary data only for a resolved file", async () => {
    const note = file("Notes/plan.md");
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const vault = {
      getFiles: vi.fn(),
      getAbstractFileByPath: vi.fn((path: string) => (path === note.path ? note : null)),
      readBinary: vi.fn().mockResolvedValue(bytes),
    };
    const provider = new ObsidianVaultFileProvider(vault as never);

    await expect(provider.readFile(note.path)).resolves.toBe(bytes);
    await expect(provider.readFile("Notes/missing.md")).resolves.toBe("");
    expect(vault.readBinary).toHaveBeenCalledOnce();
  });
});
