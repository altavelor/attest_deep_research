import { readFileSync } from "fs";
import { resolve } from "path";

describe("index-search and debug-panel static policy", () => {
  it("keeps removed indexing controls out of the index-search surface", () => {
    const controller = readFileSync(
      resolve("src/apps/obsidian/ui/index/IndexSearchController.ts"),
      "utf8",
    );
    const panel = readFileSync(resolve("src/apps/obsidian/ui/index/IndexSearchPanel.ts"), "utf8");

    expect(controller).not.toContain("renderIndexControl");
    expect(controller).not.toContain("IndexControl");
    expect(panel).not.toContain("indexControlEl");
  });

  it("declares the debug-mode redisplay wiring", () => {
    const settingsTab = readFileSync(resolve("src/apps/obsidian/ui/SettingsTab.ts"), "utf8");
    const plugin = readFileSync(resolve("src/apps/obsidian/main.ts"), "utf8");
    const view = readFileSync(resolve("src/apps/obsidian/ui/chat/IxplorerChatView.ts"), "utf8");
    const composer = readFileSync(
      resolve("src/apps/obsidian/ui/chat/ChatComposerController.ts"),
      "utf8",
    );

    expect(settingsTab).toContain("this.plugin.refreshChatViews()");
    expect(plugin).toContain("refreshChatViews(): void");
    expect(plugin).toContain("getLeavesOfType(IXPLORER_CHAT_VIEW_TYPE)");
    expect(view).toContain("redisplay(): void");
    expect(view).toContain("this.composer.render(chatPanel);");
    expect(composer).toContain("const draft = this.getQuestionInput();");
    expect(composer).toContain("this.refs.textareaEl.value = draft;");
    expect(composer).toContain("this.setFormRunning(this.options.isRunning());");
  });

  it("declares the keyword-fallback identifiers and warning classes", () => {
    const controller = readFileSync(
      resolve("src/apps/obsidian/ui/index/IndexSearchController.ts"),
      "utf8",
    );
    const panel = readFileSync(resolve("src/apps/obsidian/ui/index/IndexSearchPanel.ts"), "utf8");
    const main = readFileSync(resolve("src/apps/obsidian/main.ts"), "utf8");

    expect(main).toContain("semanticError: result.semanticError");
    expect(controller).toContain("semanticError");
    expect(panel).toContain('role: "alert"');
    expect(controller).toContain("Index search degraded to keyword-only ranking");
  });

  it("declares the profile-scoped semantic warning identifiers", () => {
    const controller = readFileSync(
      resolve("src/apps/obsidian/ui/index/IndexSearchController.ts"),
      "utf8",
    );

    const availabilityUpdater = controller.slice(
      controller.indexOf("private updateSearchAvailability"),
      controller.indexOf("private isSearchBlocked"),
    );

    expect(availabilityUpdater).toContain("this.semanticError = null;");
  });

  it("declares the host-selected profile identifiers for the preflight", () => {
    const controller = readFileSync(
      resolve("src/apps/obsidian/ui/index/IndexSearchController.ts"),
      "utf8",
    );
    const renderPanel = controller.slice(
      controller.indexOf("private renderPanel"),
      controller.indexOf("private renderResults"),
    );

    expect(renderPanel).toContain("const selectedProfileId = this.defaultSelectedProfileId();");
    expect(renderPanel).toContain("warning: this.warning(selectedProfileId)");
    expect(renderPanel).toContain("isSearchBlocked: this.isSearchBlocked(selectedProfileId)");
  });

  it("declares the explicit web-search routing identifiers", () => {
    const strategy = readFileSync(
      resolve("src/application/use-cases/research/strategies/ThinkingResearchStrategy.ts"),
      "utf8",
    );
    const sourceResolver = strategy.slice(
      strategy.indexOf("function resolveSearchSources"),
      strategy.indexOf("function isChunkList"),
    );

    expect(sourceResolver).toContain("searchSourceOptions(args)");
    expect(sourceResolver).toContain("isWebQueryIntent(args?.category)");
    expect(sourceResolver).toContain("isWebQueryRecency(args?.recency)");
  });
});
