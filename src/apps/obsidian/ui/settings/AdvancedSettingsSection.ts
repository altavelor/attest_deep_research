import { Setting } from "obsidian";

import type { Translate } from "@adapters/i18n";

export interface AdvancedSettingsSectionOptions {
  t: Translate;
  isDebugMode(): boolean;
  setDebugMode(value: boolean): void;
  getResearchExportFolder(): string;
  setResearchExportFolder(value: string): void;
  saveSettings(): Promise<void>;
  refreshChatViews(): void;
}

/**
 * Renders the collapsed Advanced block. Changing Debug mode persists the
 * setting and redisplays open chat views so debug-only cells appear or
 * disappear without reopening the view.
 */
export class AdvancedSettingsSection {
  constructor(private readonly options: AdvancedSettingsSectionOptions) {}

  render(containerEl: HTMLElement): void {
    const { t } = this.options;
    const details = containerEl.createEl("details", { cls: "attest-settings-advanced" });
    details.createEl("summary", {
      cls: "attest-settings-advanced__summary",
      text: t("common.advanced"),
    });
    const contentEl = details.createDiv({ cls: "attest-settings-advanced__content" });
    new Setting(contentEl)
      .setName(t("settings.advanced.debugMode.name"))
      .setDesc(t("settings.advanced.debugMode.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.options.isDebugMode()).onChange(async (value) => {
          this.options.setDebugMode(value);
          await this.options.saveSettings();
          this.options.refreshChatViews();
        }),
      );
    new Setting(contentEl)
      .setName(t("settings.advanced.researchExportFolder.name"))
      .setDesc(t("settings.advanced.researchExportFolder.desc"))
      .addText((text) =>
        text.setValue(this.options.getResearchExportFolder()).onChange(async (value) => {
          this.options.setResearchExportFolder(value.trim());
          await this.options.saveSettings();
        }),
      );
  }
}
