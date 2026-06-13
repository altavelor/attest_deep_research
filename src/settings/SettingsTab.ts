import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { ButtonComponent, TextComponent } from "obsidian";

import type IxplorerPlugin from "../main";
import { parseNonNegativeInteger, parsePositiveInteger } from "../shared/numbers";
import { renderIndexControl } from "../ui/IndexControl";
import { attachModelDropdown } from "../ui/ModelDropdown";
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
  INDEX_FOLDER_DESCRIPTION,
} from "./privacyCopy";
import {
  formatListInput,
  getActiveIndexProfile,
  normalizeListInput,
  normalizeUrl,
  normalizeVaultFolder,
  updateActiveIndexProfile,
} from "./settings";

type ModelSettingsSectionKind = "chat" | "embedding";

interface ModelSettingsSectionState {
  models: string[];
  providerLabel: string | null;
  isTestingBaseUrl: boolean;
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
  private unsubscribeIndexing: (() => void) | null = null;
  private readonly modelSectionStates: Record<ModelSettingsSectionKind, ModelSettingsSectionState> =
    {
      chat: {
        models: [],
        providerLabel: null,
        isTestingBaseUrl: false,
        isRefreshingModels: false,
      },
      embedding: {
        models: [],
        providerLabel: null,
        isTestingBaseUrl: false,
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
    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing = null;
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
            if (config.kind === "embedding") {
              updateActiveIndexProfile(this.plugin.settings, {
                embeddingProviderBaseUrl: this.plugin.settings.embeddingProviderBaseUrl,
              });
              this.plugin.markIndexStale();
            }
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
                if (config.kind === "chat") {
                  this.plugin.setAvailableChatModels(result.models);
                }
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

    let modelInput: TextComponent;
    let refreshButton: ButtonComponent;

    new Setting(containerEl)
      .setName(config.modelName)
      .setDesc(config.modelDescription)
      .setClass("ixplorer-settings__model-row")
      .addText((text) => {
        modelInput = text
          .setPlaceholder(config.modelPlaceholder)
          .setValue(this.plugin.settings[config.modelSettingKey])
          .onChange(async (value) => {
            const model = value.trim();
            this.plugin.settings[config.modelSettingKey] = model;
            if (config.kind === "embedding") {
              updateActiveIndexProfile(this.plugin.settings, { embeddingModel: model });
              this.plugin.markIndexStale();
            }
            await this.plugin.saveSettings();
          });
        modelInput.inputEl.addClass("ixplorer-settings__text-input");
      })
      .then((setting) => {
        attachModelDropdown({
          inputEl: modelInput.inputEl,
          containerEl: setting.controlEl,
          getModels: () => state.models,
          emptyText: "Refresh models first",
          onSelect: async (model) => {
            this.plugin.settings[config.modelSettingKey] = model.trim();
            if (config.kind === "embedding") {
              updateActiveIndexProfile(this.plugin.settings, { embeddingModel: model.trim() });
              this.plugin.markIndexStale();
            }
            await this.plugin.saveSettings();
          },
        });
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
                if (config.kind === "chat") {
                  this.plugin.setAvailableChatModels(result.models);
                }
                updateModelOptions();
                new Notice(result.message);
              },
            );
          });
        refreshButton.buttonEl.setAttr("aria-label", "Refresh model list");
      });

    function updateProviderBadge(): void {
      if (!providerBadgeEl) {
        return;
      }

      providerBadgeEl.setText(state.providerLabel ?? "");
      providerBadgeEl.toggleClass("is-hidden", state.providerLabel === null);
    }

    function updateModelOptions(): void {
      modelInput?.inputEl.toggleClass("has-model-options", state.models.length > 0);
    }
  }

  private clearModelSectionConnectionState(kind: ModelSettingsSectionKind): void {
    const state = this.modelSectionStates[kind];
    state.models = [];
    state.providerLabel = null;
  }

  private async runModelSectionAction(
    state: ModelSettingsSectionState,
    loadingKey: keyof Pick<ModelSettingsSectionState, "isTestingBaseUrl" | "isRefreshingModels">,
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

    const indexControlEl = containerEl.createDiv({ cls: "ixplorer-settings__index-control" });
    const renderCurrentIndexControl = () => {
      renderIndexControl(indexControlEl, {
        state: this.plugin.indexing.getState(),
        actions: {
          start: () => this.plugin.indexing.start(),
          pause: () => this.plugin.indexing.pause(),
          resume: () => this.plugin.indexing.resume(),
          rebuild: () => this.plugin.indexing.rebuild(),
        },
      });
    };
    this.unsubscribeIndexing = this.plugin.indexing.subscribe(renderCurrentIndexControl);
    renderCurrentIndexControl();

    new Setting(containerEl)
      .setName("Index folder")
      .setDesc(INDEX_FOLDER_DESCRIPTION)
      .addText((text) =>
        text
          .setPlaceholder(".ixplorer/index")
          .setValue(this.plugin.settings.lanceDbFolder)
          .onChange(async (value) => {
            const indexFolder = normalizeVaultFolder(value);
            this.plugin.settings.lanceDbFolder = indexFolder;
            updateActiveIndexProfile(this.plugin.settings, { indexFolder });
            await this.plugin.saveSettings();
            this.plugin.markIndexStale();
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
            updateActiveIndexProfile(this.plugin.settings, {
              includeFolders: this.plugin.settings.includeFolders,
            });
            await this.plugin.saveSettings();
            this.plugin.markIndexStale();
          }),
      );

    new Setting(containerEl)
      .setName("Chunk size")
      .setDesc("Approximate characters per indexed chunk. Rebuild the index after changing it.")
      .addText((text) =>
        text
          .setPlaceholder("800")
          .setValue(String(getActiveIndexProfile(this.plugin.settings).chunkSize))
          .onChange(async (value) => {
            const chunkSize = positiveInteger(value);
            if (!chunkSize) {
              return;
            }

            updateActiveIndexProfile(this.plugin.settings, { chunkSize });
            await this.plugin.saveSettings();
            this.plugin.markIndexStale();
          }),
      );

    new Setting(containerEl)
      .setName("Chunk overlap")
      .setDesc("Characters repeated into the next chunk. Rebuild the index after changing it.")
      .addText((text) =>
        text
          .setPlaceholder("120")
          .setValue(String(getActiveIndexProfile(this.plugin.settings).chunkOverlap))
          .onChange(async (value) => {
            const chunkOverlap = nonNegativeInteger(value);
            if (chunkOverlap === null) {
              return;
            }

            updateActiveIndexProfile(this.plugin.settings, { chunkOverlap });
            await this.plugin.saveSettings();
            this.plugin.markIndexStale();
          }),
      );

    new Setting(containerEl)
      .setName("Embedding batch size")
      .setDesc("Texts sent per embedding request. Lower it for Ollama if requests time out.")
      .addText((text) =>
        text
          .setPlaceholder("32")
          .setValue(String(getActiveIndexProfile(this.plugin.settings).embeddingBatchSize))
          .onChange(async (value) => {
            const embeddingBatchSize = positiveInteger(value);
            if (!embeddingBatchSize) {
              return;
            }

            updateActiveIndexProfile(this.plugin.settings, { embeddingBatchSize });
            await this.plugin.saveSettings();
            this.plugin.markIndexStale();
          }),
      );

    new Setting(containerEl)
      .setName("PDF chunk size")
      .setDesc("Approximate characters per PDF chunk. Larger chunks reduce embedding requests.")
      .addText((text) =>
        text
          .setPlaceholder("1400")
          .setValue(String(getActiveIndexProfile(this.plugin.settings).pdfChunkSize))
          .onChange(async (value) => {
            const pdfChunkSize = positiveInteger(value);
            if (!pdfChunkSize) {
              return;
            }

            updateActiveIndexProfile(this.plugin.settings, { pdfChunkSize });
            await this.plugin.saveSettings();
            this.plugin.markIndexStale();
          }),
      );

    new Setting(containerEl)
      .setName("PDF chunk overlap")
      .setDesc("Characters repeated into the next PDF chunk.")
      .addText((text) =>
        text
          .setPlaceholder("150")
          .setValue(String(getActiveIndexProfile(this.plugin.settings).pdfChunkOverlap))
          .onChange(async (value) => {
            const pdfChunkOverlap = nonNegativeInteger(value);
            if (pdfChunkOverlap === null) {
              return;
            }

            updateActiveIndexProfile(this.plugin.settings, { pdfChunkOverlap });
            await this.plugin.saveSettings();
            this.plugin.markIndexStale();
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
            updateActiveIndexProfile(this.plugin.settings, {
              excludeGlobs: this.plugin.settings.excludeGlobs,
            });
            await this.plugin.saveSettings();
            this.plugin.markIndexStale();
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

function positiveInteger(value: string): number | null {
  return parsePositiveInteger(value);
}

function nonNegativeInteger(value: string): number | null {
  return parseNonNegativeInteger(value);
}
