import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { ButtonComponent, TextComponent } from "obsidian";

import type IxplorerPlugin from "../main";
import {
  createConnectionClientFactories,
  detectLocalModelProvider,
  localModelProviderLabel,
  refreshChatModels,
  refreshEmbeddingModels,
  testChatConnection,
  testEmbeddingConnection,
} from "./connectionTests";
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

type ModelSettingsSectionKind = "chat" | "embedding";

interface ModelSettingsSectionState {
  models: string[];
  providerLabel: string | null;
  isTestingBaseUrl: boolean;
  isTestingModel: boolean;
  isRefreshingModels: boolean;
}

interface ModelSettingsSectionConfig {
  kind: ModelSettingsSectionKind;
  heading: string;
  providerDescription: string;
  providerPlaceholder: string;
  providerSettingKey: "chatModelProviderBaseUrl" | "embeddingProviderBaseUrl";
  modelName: string;
  modelDescription: string;
  modelPlaceholder: string;
  modelSettingKey: "chatModel" | "embeddingModel";
  testConnection: () => ReturnType<typeof testChatConnection>;
  refreshModels: () => ReturnType<typeof refreshChatModels>;
}

export class IxplorerSettingTab extends PluginSettingTab {
  private readonly modelSectionStates: Record<ModelSettingsSectionKind, ModelSettingsSectionState> =
    {
      chat: {
        models: [],
        providerLabel: null,
        isTestingBaseUrl: false,
        isTestingModel: false,
        isRefreshingModels: false,
      },
      embedding: {
        models: [],
        providerLabel: null,
        isTestingBaseUrl: false,
        isTestingModel: false,
        isRefreshingModels: false,
      },
    };

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

    this.renderDebugSettings(containerEl);
    this.renderChatModelSettings(containerEl);
    this.renderEmbeddingSettings(containerEl);
    this.renderIndexingSettings(containerEl);
    this.renderWebSearchSettings(containerEl);
  }

  private renderDebugSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc(
        "Log plugin request and response details, including prompt payloads. When disabled, only errors are logged.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderChatModelSettings(containerEl: HTMLElement): void {
    const factories = createConnectionClientFactories({ logger: this.plugin.logger });

    this.renderModelSettingsSection(containerEl, {
      kind: "chat",
      heading: "Chat Model",
      providerDescription: CHAT_PROVIDER_DESCRIPTION,
      providerPlaceholder: "http://localhost:1234/v1",
      providerSettingKey: "chatModelProviderBaseUrl",
      modelName: "Chat model",
      modelDescription: "Model name loaded by the local chat provider.",
      modelPlaceholder: "local-model",
      modelSettingKey: "chatModel",
      testConnection: () => testChatConnection(this.plugin.settings, factories),
      refreshModels: () => refreshChatModels(this.plugin.settings, factories),
    });
  }

  private renderEmbeddingSettings(containerEl: HTMLElement): void {
    const factories = createConnectionClientFactories({ logger: this.plugin.logger });

    this.renderModelSettingsSection(containerEl, {
      kind: "embedding",
      heading: "Embeddings",
      providerDescription: EMBEDDING_PROVIDER_DESCRIPTION,
      providerPlaceholder: "http://localhost:11434",
      providerSettingKey: "embeddingProviderBaseUrl",
      modelName: "Embedding model",
      modelDescription: "Model name used by the local embedding provider.",
      modelPlaceholder: "embedding-model",
      modelSettingKey: "embeddingModel",
      testConnection: () => testEmbeddingConnection(this.plugin.settings, factories),
      refreshModels: () => refreshEmbeddingModels(this.plugin.settings, factories),
    });
  }

  private renderModelSettingsSection(
    containerEl: HTMLElement,
    config: ModelSettingsSectionConfig,
  ): void {
    const state = this.modelSectionStates[config.kind];

    new Setting(containerEl).setName(config.heading).setHeading();

    let providerBadgeEl: HTMLElement;
    let providerTestButton: ButtonComponent;

    new Setting(containerEl)
      .setName("Provider base URL")
      .setDesc(config.providerDescription)
      .setClass("ixplorer-settings__provider-row")
      .addText((text) => {
        text
          .setPlaceholder(config.providerPlaceholder)
          .setValue(this.plugin.settings[config.providerSettingKey])
          .onChange(async (value) => {
            this.plugin.settings[config.providerSettingKey] = normalizeUrl(
              value,
              this.plugin.defaultSettings[config.providerSettingKey],
            );
            this.clearModelSectionConnectionState(config.kind);
            updateProviderBadge();
            updateModelOptions();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass("ixplorer-settings__text-input");
      })
      .then((setting) => {
        providerBadgeEl = setting.controlEl.createSpan({
          cls: "ixplorer-settings__provider-badge",
        });
        updateProviderBadge();
      })
      .addButton((button) => {
        providerTestButton = button
          .setButtonText("Test")
          .setDisabled(state.isTestingBaseUrl)
          .onClick(async () => {
            await this.runModelSectionAction(
              state,
              "isTestingBaseUrl",
              [providerTestButton],
              async () => {
                await this.plugin.saveSettings();
                const result = await config.testConnection();
                state.models = result.models;
                state.providerLabel = result.ok
                  ? localModelProviderLabel(
                      detectLocalModelProvider(this.plugin.settings[config.providerSettingKey]),
                    )
                  : null;
                updateProviderBadge();
                updateModelOptions();
                new Notice(result.message);
              },
            );
          });
      });

    const dataListId = `ixplorer-${config.kind}-model-options`;
    let modelInput: TextComponent;
    let dataListEl: HTMLDataListElement;
    let refreshButton: ButtonComponent;
    let modelTestButton: ButtonComponent;

    new Setting(containerEl)
      .setName(config.modelName)
      .setDesc(config.modelDescription)
      .setClass("ixplorer-settings__model-row")
      .addText((text) => {
        modelInput = text
          .setPlaceholder(config.modelPlaceholder)
          .setValue(this.plugin.settings[config.modelSettingKey])
          .onChange(async (value) => {
            this.plugin.settings[config.modelSettingKey] = value.trim();
            await this.plugin.saveSettings();
          });
        modelInput.inputEl.addClass("ixplorer-settings__text-input");
        modelInput.inputEl.setAttr("list", dataListId);
      })
      .then((setting) => {
        dataListEl = setting.controlEl.createEl("datalist", { attr: { id: dataListId } });
        updateModelOptions();
      })
      .addButton((button) => {
        refreshButton = button
          .setIcon("rotate-cw")
          .setTooltip("Refresh model list")
          .setDisabled(state.isRefreshingModels)
          .setClass("ixplorer-settings__icon-button")
          .onClick(async () => {
            await this.runModelSectionAction(
              state,
              "isRefreshingModels",
              [refreshButton],
              async () => {
                await this.plugin.saveSettings();
                const result = await config.refreshModels();
                state.models = result.models;
                updateModelOptions();
                new Notice(result.message);
              },
            );
          });
        refreshButton.buttonEl.setAttr("aria-label", "Refresh model list");
      })
      .addButton((button) => {
        modelTestButton = button
          .setButtonText("Test")
          .setDisabled(state.isTestingModel)
          .onClick(async () => {
            await this.runModelSectionAction(
              state,
              "isTestingModel",
              [modelTestButton],
              async () => {
                await this.plugin.saveSettings();
                const result = await config.testConnection();
                state.models = result.models;
                state.providerLabel = result.ok
                  ? localModelProviderLabel(
                      detectLocalModelProvider(this.plugin.settings[config.providerSettingKey]),
                    )
                  : null;
                updateProviderBadge();
                updateModelOptions();
                new Notice(result.message);
              },
            );
          });
      });

    function updateProviderBadge(): void {
      if (!providerBadgeEl) {
        return;
      }

      providerBadgeEl.setText(state.providerLabel ?? "");
      providerBadgeEl.toggleClass("is-hidden", state.providerLabel === null);
    }

    function updateModelOptions(): void {
      if (!dataListEl) {
        return;
      }

      dataListEl.empty();
      for (const model of state.models) {
        dataListEl.createEl("option", { attr: { value: model } });
      }
    }
  }

  private clearModelSectionConnectionState(kind: ModelSettingsSectionKind): void {
    const state = this.modelSectionStates[kind];
    state.models = [];
    state.providerLabel = null;
  }

  private async runModelSectionAction(
    state: ModelSettingsSectionState,
    loadingKey: keyof Pick<
      ModelSettingsSectionState,
      "isTestingBaseUrl" | "isTestingModel" | "isRefreshingModels"
    >,
    buttons: ButtonComponent[],
    action: () => Promise<void>,
  ): Promise<void> {
    if (state[loadingKey]) {
      return;
    }

    state[loadingKey] = true;
    for (const button of buttons) {
      button.setDisabled(true);
    }

    try {
      await action();
    } finally {
      state[loadingKey] = false;
      for (const button of buttons) {
        button.setDisabled(false);
      }
    }
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
