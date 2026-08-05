import { IxplorerSettings } from "@adapters/settings";
import { WebSourceHealthTracker } from "@application/web";
import { App, Setting, setIcon } from "obsidian";
import { WebSourcesSection } from "./WebSourcesSection";
import { renderCategoryHeading, renderSubcategoryHeading } from "./shared";

export interface RetrievalSettingsSectionOptions {
  app: App;
  settings: IxplorerSettings;
  webSourceHealth: WebSourceHealthTracker;
  hasActiveChatModel: boolean;
  saveSettings(): Promise<void>;
  requestRedisplay(): void;
}

/** Renders all retrieval, graph-context, and web-source settings. */
export class RetrievalSettingsSection {
  constructor(private readonly options: RetrievalSettingsSectionOptions) {}

  render(containerEl: HTMLElement): void {
    const contentEl = this.gateHost(containerEl);
    renderCategoryHeading(
      contentEl,
      "Retrieval",
      "Controls how Ixplorer finds local, graph, index, document, and web evidence before answering.",
    );
    this.renderGraphContext(contentEl);
    this.renderSearch(contentEl);
    this.renderWeb(contentEl);
  }

  private gateHost(containerEl: HTMLElement): HTMLElement {
    if (this.options.hasActiveChatModel) return containerEl;

    const section = containerEl.createDiv({ cls: "ixplorer-settings__gated-section" });
    const hint = section.createDiv({ cls: "ixplorer-settings__gate-hint" });
    setIcon(hint.createSpan({ cls: "ixplorer-settings__gate-hint-icon" }), "info");
    hint.createSpan({ text: "Add a chat model profile first" });
    return section.createDiv({
      cls: "ixplorer-settings__gated-content is-disabled",
      attr: { "aria-disabled": "true", inert: "" },
    });
  }

  private renderGraphContext(containerEl: HTMLElement): void {
    renderSubcategoryHeading(containerEl, "Obsidian graph");
    this.addToggle(
      containerEl,
      "Use linked notes",
      "Discover linked notes from @mentions, active files, and included attachments before retrieval.",
      "useLinkedNotes",
    );
    this.addToggle(
      containerEl,
      "Include backlinks",
      "Use one-hop backlinks as graph candidates. Backlink notes are not traversed further.",
      "includeBacklinks",
    );
    this.addToggle(
      containerEl,
      "Expand filtered files through links",
      "When attached files are in Filter mode, also search their linked graph neighbors.",
      "expandFilteredContextThroughLinks",
    );
    new Setting(containerEl)
      .setName("Graph depth")
      .setDesc(
        "Depth 1 follows direct links, embeds, and backlinks. Depth 2 is reserved for advanced debugging.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("1", "1")
          .addOption("2", "2")
          .setValue(String(this.options.settings.graphContextDepth))
          .onChange(async (value) => {
            this.options.settings.graphContextDepth = value === "2" ? 2 : 1;
            await this.options.saveSettings();
          }),
      );
  }

  private renderSearch(containerEl: HTMLElement): void {
    renderSubcategoryHeading(containerEl, "Search");
    this.addToggle(
      containerEl,
      "Expand search query",
      "Generate cross-language query variants before retrieval so notes written in other languages are found. Uses an extra chat-model call per search.",
      "expandSearchQuery",
    );
  }

  private renderWeb(containerEl: HTMLElement): void {
    renderSubcategoryHeading(containerEl, "Web");
    this.addToggle(
      containerEl,
      "Use web for freshness questions",
      "Give web evidence more budget when a question asks for current, latest, price, or release information.",
      "useWebWhenFreshnessNeeded",
    );
    new WebSourcesSection({
      app: this.options.app,
      getSettings: () => this.options.settings,
      saveSettings: () => this.options.saveSettings(),
      requestRedisplay: () => this.options.requestRedisplay(),
      getSourceIssue: (sourceId) => this.options.webSourceHealth.getIssue(sourceId),
      resetSourceIssue: (sourceId) => this.options.webSourceHealth.reset(sourceId),
    }).render(containerEl);
  }

  private addToggle(
    containerEl: HTMLElement,
    name: string,
    description: string,
    key:
      | "useLinkedNotes"
      | "includeBacklinks"
      | "expandFilteredContextThroughLinks"
      | "expandSearchQuery"
      | "useWebWhenFreshnessNeeded",
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addToggle((toggle) =>
        toggle.setValue(this.options.settings[key]).onChange(async (value) => {
          this.options.settings[key] = value;
          await this.options.saveSettings();
        }),
      );
  }
}
