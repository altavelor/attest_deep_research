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
  const chatComposerSource = readFileSync(
    resolve("src/apps/obsidian/ui/chat/ChatComposer.ts"),
    "utf8",
  );

  it("keeps Tools and reasoning controls while hiding protocol selection", () => {
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

  it("refreshes generation capabilities explicitly without requiring profile re-save", () => {
    expect(source).toContain('icon: "flask-conical"');
    expect(source).toContain("this.prober.startChatProfileProbes(profile.id, true)");
    expect(source).not.toContain("this.prober.startChatProfileProbes(updatedProfile.id)");
    expect(source).toContain("startEmbeddingProfileProbe(profile.id)");
    expect(source).toContain("startEmbeddingProfileProbe(updatedProfile.id)");
    expect(source).not.toContain("await this.detectChatCapabilities(server)");
    expect(source).not.toContain("await this.options.verifyEmbedding");
    expect(source).toContain(
      'profile.reasoning.summary = reasoningCapabilities.summary ? "auto" : "off"',
    );
  });

  it("keeps gated settings unavailable to pointer and keyboard input", () => {
    expect(source).toContain('attr: { "aria-disabled": "true", inert: "" }');
  });

  it("keeps modal capability controls consistent after state changes", () => {
    expect(source).toContain("this.testing = false;");
    expect(source).toContain("this.render();");
    expect(source).not.toContain("} else if (!this.toolsVerifiedSeen) {");
  });

  it("does not retain inline mechanics comments in the chat composer", () => {
    expect(chatComposerSource).not.toContain(
      "Right cluster: context-window indicator, model selector, submit.",
    );
    expect(chatComposerSource).not.toContain("Thinking mode drives the agentic research strategy");
  });

  it("keeps capability test status live in the profile modal", () => {
    expect(source).toContain("subscribeCapabilityStatus");
    expect(source).toContain("getCapabilityStatus");
    expect(source).toContain('setIcon("flask-conical")');
    expect(source).toContain(
      'hasCapabilityTestResult(options.currentProfile) ? "Re-test" : "Test"',
    );
    expect(source).toContain("formatCapabilityVerificationStatus");
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
    expect(advancedRenderer).not.toContain("Force instant research mode");

    const searchRenderer = source.slice(
      source.indexOf("private renderSearchEngineSettings"),
      source.indexOf("private renderProfileSettings"),
    );
    expect(searchRenderer).not.toContain("Debug mode");
    expect(searchRenderer).not.toContain("Force instant research mode");
  });

  it("preserves the index path picker scroll position when checkbox selection rerenders", () => {
    expect(source).toContain("preserveScroll?: boolean");
    expect(source).toContain(
      "const scrollTop = options.preserveScroll ? this.treeEl.scrollTop : null",
    );
    expect(source).toContain("this.treeEl.scrollTop = scrollTop");
    expect(source).toContain("this.renderTree({ preserveScroll: true })");
  });
});
