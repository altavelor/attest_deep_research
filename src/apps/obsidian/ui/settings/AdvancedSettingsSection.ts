import { Setting } from "obsidian";

export interface AdvancedSettingsSectionOptions {
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
    const details = containerEl.createEl("details", { cls: "ixplorer-settings-advanced" });
    details.createEl("summary", { cls: "ixplorer-settings-advanced__summary", text: "Advanced" });
    new Setting(details.createDiv({ cls: "ixplorer-settings-advanced__content" }))
      .setName("Debug mode")
      .setDesc("Log plugin request and response details. API keys are redacted.")
      .addToggle((toggle) =>
        toggle.setValue(this.options.isDebugMode()).onChange(async (value) => {
          this.options.setDebugMode(value);
          await this.options.saveSettings();
          this.options.refreshChatViews();
        }),
      );
  }
}
