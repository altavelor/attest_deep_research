import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";

describe("settings surface static policy", () => {
  const settingsDir = resolve("src/apps/obsidian/ui/settings");
  const source = [
    readFileSync(resolve("src/apps/obsidian/ui/SettingsTab.ts"), "utf8"),
    ...readdirSync(settingsDir)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(resolve(settingsDir, file), "utf8")),
  ].join("\n");

  it("declares the Tools and reasoning controls", () => {
    expect(source).toContain('.setName("Tools")');
    expect(source).toContain('.setName("Agentic mode")');
    expect(source).toContain('.setName("Reasoning effort")');
  });

  it("renders the indexing section before the advanced section", () => {
    const advancedSectionIndex = source.indexOf("this.renderAdvancedSettings(this.containerEl)");
    const indexingSectionIndex = source.indexOf(
      "this.indexProfiles.render(this.gateHost(this.containerEl))",
    );

    expect(indexingSectionIndex).toBeGreaterThan(-1);
    expect(advancedSectionIndex).toBeGreaterThan(indexingSectionIndex);
  });
});
