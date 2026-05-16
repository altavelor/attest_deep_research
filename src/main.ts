import { join } from "path";

import { FileSystemAdapter, Plugin } from "obsidian";

import { ChatModelClient } from "./client/chat/ChatModelClient";
import { EmbeddingClient } from "./client/embeddings/EmbeddingClient";
import { LanceDbIndexStore } from "./indexing/LanceDbIndexStore";
import { RealLanceDbDriver } from "./indexing/RealLanceDbDriver";
import { RetrievalService } from "./retrieval/RetrievalService";
import { ResearchService } from "./research/ResearchService";
import { IxplorerSettingTab } from "./settings/SettingsTab";
import { detectLocalModelProvider } from "./settings/connectionTests";
import { DEFAULT_SETTINGS, IxplorerSettings, migrateSettings } from "./settings/settings";
import { IXPLORER_CHAT_VIEW_TYPE, IxplorerChatView } from "./ui/IxplorerChatView";
import { DuckDuckGoSearchProvider } from "./web/DuckDuckGoSearchProvider";

export default class IxplorerPlugin extends Plugin {
  readonly defaultSettings = DEFAULT_SETTINGS;
  settings: IxplorerSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(
      IXPLORER_CHAT_VIEW_TYPE,
      (leaf) =>
        new IxplorerChatView(leaf, {
          createResearchService: () => this.createResearchService(),
          isWebSearchEnabled: () => this.settings.duckDuckGoEnabled,
        }),
    );
    this.addCommand({
      id: "open-ixplorer-chat",
      name: "Open Ixplorer chat",
      icon: "bot-message-square",
      callback: () => {
        void this.activateChatView();
      },
    });
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

  async activateChatView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(IXPLORER_CHAT_VIEW_TYPE)[0];
    const leaf =
      existingLeaf ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);

    await leaf.setViewState({
      type: IXPLORER_CHAT_VIEW_TYPE,
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private createResearchService(): ResearchService {
    const embeddings = new EmbeddingClient({
      provider: detectLocalModelProvider(this.settings.embeddingProviderBaseUrl),
      baseUrl: this.settings.embeddingProviderBaseUrl,
    });
    const retriever = new RetrievalService({
      embeddings,
      indexStore: new LanceDbIndexStore({
        folder: this.getVaultLocalPath(this.settings.lanceDbFolder),
        driver: new RealLanceDbDriver(),
      }),
      embeddingModel: this.settings.embeddingModel,
      keywordCorpus: [],
    });

    return new ResearchService({
      retriever,
      chatModel: new ChatModelClient({
        provider: detectLocalModelProvider(this.settings.chatModelProviderBaseUrl),
        baseUrl: this.settings.chatModelProviderBaseUrl,
      }),
      chatModelName: this.settings.chatModel,
      searchProvider: this.settings.duckDuckGoEnabled ? new DuckDuckGoSearchProvider() : undefined,
    });
  }

  private getVaultLocalPath(path: string): string {
    const adapter = this.app.vault.adapter;

    if (adapter instanceof FileSystemAdapter) {
      return join(adapter.getBasePath(), path);
    }

    return path;
  }
}
