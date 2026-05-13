import { Plugin } from "obsidian";

import { IxplorerSettingTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, IxplorerSettings, migrateSettings } from "./settings/settings";

export default class IxplorerPlugin extends Plugin {
  readonly defaultSettings = DEFAULT_SETTINGS;
  settings: IxplorerSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new IxplorerSettingTab(this.app, this));
  }

  onunload(): void {
    // Settings tabs are managed by Obsidian after registration.
  }

  async loadSettings(): Promise<void> {
    this.settings = migrateSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
