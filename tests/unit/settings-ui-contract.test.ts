import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";

describe("chat model settings surface", () => {
  // The settings UI is split across SettingsTab.ts and the ./settings modules
  // (modals, shared helpers). Read them all so the contract holds wherever a
  // given control lives.
  const settingsDir = resolve("src/apps/obsidian/ui/settings");
  const source = [
    readFileSync(resolve("src/apps/obsidian/ui/SettingsTab.ts"), "utf8"),
    ...readdirSync(settingsDir)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(resolve(settingsDir, file), "utf8")),
  ].join("\n");

  it("keeps Tools and reasoning controls while hiding protocol selection", () => {
    expect(source).toContain('.setName("Tools")');
    expect(source).toContain('.setName("Reasoning")');
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

  it("refreshes generation capabilities explicitly without requiring profile re-save", () => {
    expect(source).toContain('label: "Refresh capabilities"');
    expect(source).toContain("this.prober.startChatProfileProbes(profile.id)");
    expect(source).not.toContain("this.prober.startChatProfileProbes(updatedProfile.id)");
    expect(source).toContain("startEmbeddingProfileProbe(profile.id)");
    expect(source).toContain("startEmbeddingProfileProbe(updatedProfile.id)");
    expect(source).not.toContain("await this.detectChatCapabilities(server)");
    expect(source).not.toContain("await this.options.verifyEmbedding");
    expect(source).toContain(
      'profile.reasoning.summary = reasoningCapabilities.summary ? "auto" : "off"',
    );
  });

  it("keeps debug-only settings in the final Advanced section", () => {
    const displayBody = source.slice(
      source.indexOf("display(): void"),
      source.indexOf("private renderDebugSettings"),
    );
    const advancedSectionIndex = source.indexOf("renderAdvancedSettings(containerEl)");
    const indexingSectionIndex = source.indexOf("renderIndexingSettings(containerEl)");
    expect(advancedSectionIndex).toBeGreaterThan(indexingSectionIndex);
    expect(displayBody).not.toContain("renderDebugSettings(containerEl)");

    const advancedRenderer = source.slice(
      source.indexOf("private renderAdvancedSettings"),
      source.indexOf("private renderProfileSettings"),
    );
    expect(advancedRenderer).toContain("this.renderDebugSettings(contentEl)");
    expect(advancedRenderer).toContain("Force eager research mode");

    const searchRenderer = source.slice(
      source.indexOf("private renderSearchEngineSettings"),
      source.indexOf("private renderProfileSettings"),
    );
    expect(searchRenderer).not.toContain("Debug mode");
    expect(searchRenderer).not.toContain("Force eager research mode");
  });

  it("preserves the index path picker scroll position when checkbox selection rerenders", () => {
    expect(source).toContain("preserveScroll?: boolean");
    expect(source).toContain("const scrollTop = options.preserveScroll ? this.treeEl.scrollTop : null");
    expect(source).toContain("this.treeEl.scrollTop = scrollTop");
    expect(source).toContain("this.renderTree({ preserveScroll: true })");
  });
});
