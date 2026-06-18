import { describe, expect, it, vi } from "vitest";

import { ObsidianSkillFileStore } from "../../src/skills/ObsidianSkillFileStore";

describe("ObsidianSkillFileStore", () => {
  it("delegates hidden-folder operations to the vault adapter", async () => {
    const adapter = {
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["a"], folders: ["b"] }),
      read: vi.fn().mockResolvedValue("body"),
      write: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    };
    const store = new ObsidianSkillFileStore(adapter);

    await expect(store.exists(".ixplorer/skills")).resolves.toBe(true);
    await expect(store.list(".ixplorer/skills")).resolves.toEqual({
      files: ["a"],
      folders: ["b"],
    });
    await expect(store.read("skill.md")).resolves.toBe("body");
    await store.write("skill.md", "new");
    await store.mkdir("folder");

    expect(adapter.write).toHaveBeenCalledWith("skill.md", "new");
    expect(adapter.mkdir).toHaveBeenCalledWith("folder");
  });
});
