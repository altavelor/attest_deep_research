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
  const chatComposerSource = readFileSync(
    resolve("src/apps/obsidian/ui/chat/ChatComposer.ts"),
    "utf8",
  );

  it("declares the Tools and reasoning controls and no removed control names", () => {
    expect(source).toContain('.setName("Tools")');
    expect(source).toContain('.setName("Agentic mode")');
    expect(source).toContain('.setName("Reasoning effort")');
    expect(source).not.toContain('.setName("API protocol")');

    for (const removedControl of [
      "Probe Responses",
      "Probe tool controls",
      "Allowed reasoning efforts",
      "Manual Responses override",
      "Required tool choice",
      "Specific tool choice",
      "Parallel tool calls",
    ]) {
      expect(source).not.toContain(`.setName("${removedControl}")`);
    }
  });

  it("keeps the removed probing and verification calls out of the settings surface", () => {
    expect(source).not.toContain("startChatProfileProbes(updatedProfile.id)");
    expect(source).not.toContain("await this.detectChatCapabilities(server)");
    expect(source).not.toContain("await this.options.verifyEmbedding");
    expect(source).not.toContain("} else if (!this.toolsVerifiedSeen) {");
  });

  it("declares the aria-disabled and inert attributes on gated settings", () => {
    expect(source).toContain('attr: { "aria-disabled": "true", inert: "" }');
  });

  it("keeps removed inline mechanics comments out of the chat composer", () => {
    expect(chatComposerSource).not.toContain(
      "Right cluster: context-window indicator, model selector, submit.",
    );
    expect(chatComposerSource).not.toContain("Thinking mode drives the agentic research strategy");
  });

  it("places the Debug mode control in the advanced renderer only", () => {
    const displayBody = source.slice(
      source.indexOf("display(): void"),
      source.indexOf("hide(): void"),
    );
    const advancedSectionIndex = source.indexOf("this.renderAdvancedSettings(this.containerEl)");
    const indexingSectionIndex = source.indexOf(
      "this.indexProfiles.render(this.gateHost(this.containerEl))",
    );
    expect(advancedSectionIndex).toBeGreaterThan(indexingSectionIndex);
    expect(displayBody).not.toContain('.setName("Debug mode")');

    const advancedRenderer = source.slice(
      source.indexOf("private renderAdvancedSettings"),
      source.length,
    );
    expect(advancedRenderer).toContain('.setName("Debug mode")');
    expect(advancedRenderer).not.toContain("Force instant research mode");
  });
});
