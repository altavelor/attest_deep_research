import { join } from "path";

import { FileSystemAdapter, Notice, Plugin, TFile, Vault } from "obsidian";

import { ChatModelClient } from "./client/chat/ChatModelClient";
import { EmbeddingClient } from "./client/embeddings/EmbeddingClient";
import { DocxExtractor } from "./extractors/DocxExtractor";
import { EpubExtractor } from "./extractors/EpubExtractor";
import { Fb2Extractor } from "./extractors/Fb2Extractor";
import { MarkdownExtractor } from "./extractors/MarkdownExtractor";
import { PdfExtractor } from "./extractors/PdfExtractor";
import { TextExtractor } from "./extractors/TextExtractor";
import { IndexingController } from "./indexing/IndexingController";
import {
  IndexingService,
  IndexingState,
  VaultFileProvider,
  VaultFileSummary,
} from "./indexing/IndexingService";
import { LanceDbIndexStore } from "./indexing/LanceDbIndexStore";
import { RealLanceDbDriver } from "./indexing/RealLanceDbDriver";
import { measureFolderSize } from "./indexing/indexSize";
import { RetrievalService } from "./retrieval/RetrievalService";
import { ResearchService } from "./research/ResearchService";
import { IxplorerSettingTab } from "./settings/SettingsTab";
import { detectLocalModelProvider } from "./settings/connectionTests";
import { PluginDebugLogger } from "./settings/debugLogger";
import { DEFAULT_SETTINGS, IxplorerSettings, migrateSettings } from "./settings/settings";
import { toUserMessage } from "./shared/errors";
import { IXPLORER_CHAT_VIEW_TYPE, IxplorerChatView } from "./ui/IxplorerChatView";
import { DuckDuckGoSearchProvider } from "./web/DuckDuckGoSearchProvider";

export default class IxplorerPlugin extends Plugin {
  readonly defaultSettings = DEFAULT_SETTINGS;
  settings: IxplorerSettings = DEFAULT_SETTINGS;
  readonly logger = new PluginDebugLogger({ getSettings: () => this.settings });
  readonly indexing = new IndexingController({
    createService: (onProgress) => this.createIndexingService(onProgress),
    measureIndexSize: () => measureFolderSize(this.getVaultLocalPath(this.settings.lanceDbFolder)),
    onError: (error) => new Notice(toUserMessage(error)),
  });
  private availableChatModels: string[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    void this.indexing.refreshIndexSize();
    this.registerView(
      IXPLORER_CHAT_VIEW_TYPE,
      (leaf) =>
        new IxplorerChatView(leaf, {
          createResearchService: () => this.createResearchService(),
          getIndexingState: () => this.indexing.getState(),
          subscribeToIndexingState: (listener) => this.indexing.subscribe(listener),
          indexingActions: {
            start: () => this.indexing.start(),
            pause: () => this.indexing.pause(),
            resume: () => this.indexing.resume(),
            rebuild: () => this.indexing.rebuild(),
          },
          isWebSearchEnabled: () => this.settings.duckDuckGoEnabled,
          getChatModel: () => this.settings.chatModel,
          setChatModel: async (model) => {
            this.settings.chatModel = model.trim();
            await this.saveSettings();
          },
          getAvailableChatModels: () => [...this.availableChatModels],
          isChatIndexControlShown: () => this.settings.showChatIndexControl,
          setChatIndexControlShown: async (shown) => {
            this.settings.showChatIndexControl = shown;
            await this.saveSettings();
          },
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

  setAvailableChatModels(models: string[]): void {
    this.availableChatModels = [...models];
  }

  markIndexStale(): void {
    this.indexing.markStale();
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
      logger: this.logger,
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
        logger: this.logger,
      }),
      chatModelName: this.settings.chatModel,
      searchProvider: this.settings.duckDuckGoEnabled
        ? new DuckDuckGoSearchProvider({ logger: this.logger })
        : undefined,
    });
  }

  private createIndexingService(onProgress: (state: IndexingState) => void): IndexingService {
    const embeddings = new EmbeddingClient({
      provider: detectLocalModelProvider(this.settings.embeddingProviderBaseUrl),
      baseUrl: this.settings.embeddingProviderBaseUrl,
      logger: this.logger,
    });

    return new IndexingService({
      files: new ObsidianVaultFileProvider(this.app.vault),
      extractors: [
        MarkdownExtractor.fromSettings(this.settings),
        new TextExtractor(),
        new PdfExtractor(),
        new EpubExtractor(),
        new Fb2Extractor(),
        new DocxExtractor(),
      ],
      embeddings,
      indexStore: new LanceDbIndexStore({
        folder: this.getVaultLocalPath(this.settings.lanceDbFolder),
        driver: new RealLanceDbDriver(),
      }),
      embeddingModel: this.settings.embeddingModel,
      includeFolders: this.settings.includeFolders,
      excludeGlobs: this.settings.excludeGlobs,
      onProgress,
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

class ObsidianVaultFileProvider implements VaultFileProvider {
  constructor(private readonly vault: Vault) {}

  async listFiles(): Promise<VaultFileSummary[]> {
    return this.vault.getFiles().map((file) => ({
      path: file.path,
      modifiedTime: file.stat.mtime,
    }));
  }

  async readFile(path: string): Promise<ArrayBuffer | string> {
    const file = this.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      return "";
    }

    return this.vault.readBinary(file);
  }
}
