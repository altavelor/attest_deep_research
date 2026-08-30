import { describe, expect, it } from "vitest";
import { readStyleModules } from "../helpers/readStyles";

describe("Obsidian CSS compatibility", () => {
  it("avoids declarations and selectors rejected by the plugin validator", () => {
    for (const { file, css } of readStyleModules()) {
      expect(css, file).not.toMatch(/!important\b/);
      expect(css, file).not.toMatch(/:has\s*\(/);
      expect(css, file).not.toMatch(/\bcolumn-gap\s*:/);
      expect(css, file).not.toMatch(/\bclip-path\s*:/);
    }
  });
});
