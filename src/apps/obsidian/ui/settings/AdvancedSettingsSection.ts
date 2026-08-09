import { Setting } from "obsidian";

import type { Translate } from "@adapters/i18n";

export interface AdvancedSettingsSectionOptions {
  t: Translate;
  isDebugMode(): boolean;
  setDebugMode(value: boolean): void;
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
    const details = containerEl.createEl("details", { cls: "ixplorer-settings-advanced" });
    details.createEl("summary", {
      cls: "ixplorer-settings-advanced__summary",
      text: t("common.advanced"),
    });
    new Setting(details.createDiv({ cls: "ixplorer-settings-advanced__content" }))
      .setName(t("settings.advanced.debugMode.name"))
      .setDesc(t("settings.advanced.debugMode.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.options.isDebugMode()).onChange(async (value) => {
          this.options.setDebugMode(value);
          await this.options.saveSettings();
          this.options.refreshChatViews();
        }),
      );
  }
}
