import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import type IxplorerPlugin from "../main";
import { testChatConnection, testEmbeddingConnection } from "./connectionTests";
import {
  CHAT_PROVIDER_DESCRIPTION,
  DUCK_DUCK_GO_DESCRIPTION,
  EMBEDDING_PROVIDER_DESCRIPTION,
  LANCEDB_FOLDER_DESCRIPTION,
} from "./privacyCopy";
import {
  formatListInput,
  normalizeListInput,
  normalizeUrl,
  normalizeVaultFolder,
} from "./settings";

export class IxplorerSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: IxplorerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ixplorer-settings");

    new Setting(containerEl).setName("Ixplorer").setHeading();

    this.renderChatModelSettings(containerEl);
    this.renderEmbeddingSettings(containerEl);
    this.renderIndexingSettings(containerEl);
    this.renderWebSearchSettings(containerEl);
  }

  private renderChatModelSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Chat Model").setHeading();

    new Setting(containerEl)
      .setName("Provider base URL")
      .setDesc(CHAT_PROVIDER_DESCRIPTION)
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:1234/v1")
          .setValue(this.plugin.settings.chatModelProviderBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.chatModelProviderBaseUrl = normalizeUrl(
              value,
              this.plugin.defaultSettings.chatModelProviderBaseUrl,
            );
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Chat model")
      .setDesc("Model name loaded by the local chat provider.")
      .addText((text) =>
        text
          .setPlaceholder("local-model")
          .setValue(this.plugin.settings.chatModel)
          .onChange(async (value) => {
            this.plugin.settings.chatModel = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Test chat connection")
      .setDesc("Check the configured local chat provider and model.")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          await this.plugin.saveSettings();
          const result = await testChatConnection(this.plugin.settings);
          new Notice(result.message);
        }),
      );
  }

  private renderEmbeddingSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Embeddings").setHeading();

    new Setting(containerEl)
      .setName("Provider base URL")
      .setDesc(EMBEDDING_PROVIDER_DESCRIPTION)
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.embeddingProviderBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.embeddingProviderBaseUrl = normalizeUrl(
              value,
              this.plugin.defaultSettings.embeddingProviderBaseUrl,
            );
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc("Model name used by the local embedding provider.")
      .addText((text) =>
        text
          .setPlaceholder("embedding-model")
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (value) => {
            this.plugin.settings.embeddingModel = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Test embedding connection")
      .setDesc("Check the configured local embedding provider and model.")
      .addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          await this.plugin.saveSettings();
          const result = await testEmbeddingConnection(this.plugin.settings);
          new Notice(result.message);
        }),
      );
  }

  private renderIndexingSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Indexing").setHeading();

    new Setting(containerEl)
      .setName("LanceDB folder")
      .setDesc(LANCEDB_FOLDER_DESCRIPTION)
      .addText((text) =>
        text
          .setPlaceholder(".ixplorer/index")
          .setValue(this.plugin.settings.lanceDbFolder)
          .onChange(async (value) => {
            this.plugin.settings.lanceDbFolder = normalizeVaultFolder(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Included folders")
      .setDesc("One vault folder per line. Use / for the whole vault.")
      .addTextArea((text) =>
        text
          .setValue(formatListInput(this.plugin.settings.includeFolders))
          .onChange(async (value) => {
            const folders = normalizeListInput(value);
            this.plugin.settings.includeFolders =
              folders.length > 0 ? folders : [...this.plugin.defaultSettings.includeFolders];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Excluded globs")
      .setDesc("One glob pattern per line.")
      .addTextArea((text) =>
        text
          .setValue(formatListInput(this.plugin.settings.excludeGlobs))
          .onChange(async (value) => {
            const globs = normalizeListInput(value);
            this.plugin.settings.excludeGlobs =
              globs.length > 0 ? globs : [...this.plugin.defaultSettings.excludeGlobs];
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderWebSearchSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Web Search").setHeading();

    new Setting(containerEl)
      .setName("DuckDuckGo")
      .setDesc(DUCK_DUCK_GO_DESCRIPTION)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.duckDuckGoEnabled).onChange(async (value) => {
          this.plugin.settings.duckDuckGoEnabled = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
