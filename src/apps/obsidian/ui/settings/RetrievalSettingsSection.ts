import { IxplorerSettings } from "@adapters/settings";
import { WebSourceHealthTracker } from "@application/web";
import { App, Setting, setIcon } from "obsidian";
import type { Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { WebSourcesSection } from "./WebSourcesSection";
import { renderCategoryHeading, renderSubcategoryHeading } from "./shared";

export interface RetrievalSettingsSectionOptions {
  app: App;
  t: Translate;
  getDirection?(): TextDirection;
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
    const { t } = this.options;
    const contentEl = this.gateHost(containerEl);
    renderCategoryHeading(contentEl, t("settings.retrieval.heading"), t("settings.retrieval.desc"));
    this.renderGraphContext(contentEl);
    this.renderSearch(contentEl);
    this.renderWeb(contentEl);
  }

  private gateHost(containerEl: HTMLElement): HTMLElement {
    if (this.options.hasActiveChatModel) return containerEl;

    const section = containerEl.createDiv({ cls: "ixplorer-settings__gated-section" });
    const hint = section.createDiv({ cls: "ixplorer-settings__gate-hint" });
    setIcon(hint.createSpan({ cls: "ixplorer-settings__gate-hint-icon" }), "info");
    hint.createSpan({ text: this.options.t("settings.tab.gateHint") });
    return section.createDiv({
      cls: "ixplorer-settings__gated-content is-disabled",
      attr: { "aria-disabled": "true", inert: "" },
    });
  }

  private renderGraphContext(containerEl: HTMLElement): void {
    const { t } = this.options;
    renderSubcategoryHeading(containerEl, t("settings.retrieval.graph.heading"));
    this.addToggle(
      containerEl,
      t("settings.retrieval.useLinkedNotes.name"),
      t("settings.retrieval.useLinkedNotes.desc"),
      "useLinkedNotes",
    );
    this.addToggle(
      containerEl,
      t("settings.retrieval.includeBacklinks.name"),
      t("settings.retrieval.includeBacklinks.desc"),
      "includeBacklinks",
    );
    this.addToggle(
      containerEl,
      t("settings.retrieval.expandFilteredContextThroughLinks.name"),
      t("settings.retrieval.expandFilteredContextThroughLinks.desc"),
      "expandFilteredContextThroughLinks",
    );
    new Setting(containerEl)
      .setName(t("settings.retrieval.graphDepth.name"))
      .setDesc(t("settings.retrieval.graphDepth.desc"))
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
    const { t } = this.options;
    renderSubcategoryHeading(containerEl, t("settings.retrieval.search.heading"));
    this.addToggle(
      containerEl,
      t("settings.retrieval.expandSearchQuery.name"),
      t("settings.retrieval.expandSearchQuery.desc"),
      "expandSearchQuery",
    );
  }

  private renderWeb(containerEl: HTMLElement): void {
    const { t } = this.options;
    renderSubcategoryHeading(containerEl, t("settings.retrieval.web.heading"));
    this.addToggle(
      containerEl,
      t("settings.retrieval.useWebWhenFreshnessNeeded.name"),
      t("settings.retrieval.useWebWhenFreshnessNeeded.desc"),
      "useWebWhenFreshnessNeeded",
    );
    new WebSourcesSection({
      app: this.options.app,
      t: this.options.t,
      getDirection: this.options.getDirection,
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
