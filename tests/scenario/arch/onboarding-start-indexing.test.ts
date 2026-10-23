import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("onboarding wiring in main.ts", () => {
  it("builds the first index as a rebuild so it is not left flagged for reindexing", () => {
    const source = readFileSync(resolve("src/apps/obsidian/main.ts"), "utf8");
    const wizardStart = source.slice(source.indexOf("onStartIndexing:"));

    expect(wizardStart.slice(0, wizardStart.indexOf("},"))).toContain('mode: "rebuild"');
  });
});
