import { describe, expect, it } from "vitest";

import { withVaultConfigExclusion } from "@adapters/settings";

describe("vault configuration exclusion", () => {
  it("adds the active Obsidian configuration directory to index exclusions", () => {
    expect(withVaultConfigExclusion(["Archive/**"], ".config/obsidian/")).toEqual([
      ".config/obsidian/**",
      "Archive/**",
    ]);
  });

  it("does not duplicate an existing configuration-directory exclusion", () => {
    expect(withVaultConfigExclusion([".vault-config/**"], ".vault-config")).toEqual([
      ".vault-config/**",
    ]);
  });
});
