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
import { FileVectorIndexStore } from "./indexing/FileVectorIndexStore";
import { measureFolderSize } from "./indexing/indexSize";
import { RetrievalService } from "./retrieval/RetrievalService";
import { ResearchService } from "./research/ResearchService";
import { IxplorerSettingTab } from "./settings/SettingsTab";
import { detectLocalModelProvider } from "./settings/connectionTests";
import { PluginDebugLogger } from "./settings/debugLogger";
import {
  DEFAULT_SETTINGS,
  IxplorerSettings,
  getActiveIndexProfile,
  migrateSettings,
} from "./settings/settings";
import { toUserMessage } from "./shared/errors";
import { IXPLORER_CHAT_VIEW_TYPE, IxplorerChatView } from "./ui/IxplorerChatView";
import { DuckDuckGoSearchProvider } from "./web/DuckDuckGoSearchProvider";

export default class IxplorerPlugin extends Plugin {
  readonly defaultSettings = DEFAULT_SETTINGS;
  settings: IxplorerSettings = DEFAULT_SETTINGS;
  readonly logger = new PluginDebugLogger({ getSettings: () => this.settings });
  readonly indexing = new IndexingController({
    createService: (onProgress) => this.createIndexingService(onProgress),
    measureIndexSize: () =>
      measureFolderSize(this.getVaultLocalPath(getActiveIndexProfile(this.settings).indexFolder)),
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
          getIndexProfiles: () =>
            this.settings.indexProfiles.map((profile) => ({ id: profile.id, name: profile.name })),
          searchIndex: (options) => this.searchIndex(options),
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
    const indexProfile = getActiveIndexProfile(this.settings);
    const embeddings = new EmbeddingClient({
      provider: detectLocalModelProvider(indexProfile.embeddingProviderBaseUrl),
      baseUrl: indexProfile.embeddingProviderBaseUrl,
      logger: this.logger,
    });
    const retriever = new RetrievalService({
      embeddings,
      indexStore: new FileVectorIndexStore({
        folder: this.getVaultLocalPath(indexProfile.indexFolder),
        profileId: indexProfile.id,
        shardCount: indexProfile.shardCount,
        onPerformance: (event) => this.logger.logIndexingPerformance(event),
      }),
      embeddingModel: indexProfile.embeddingModel,
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

  private async searchIndex(options: {
    profileId: string;
    query: string;
    limit: number;
    minScore?: number;
    extension?: string;
  }) {
    const indexProfile =
      this.settings.indexProfiles.find((profile) => profile.id === options.profileId) ??
      getActiveIndexProfile(this.settings);
    const embeddings = new EmbeddingClient({
      provider: detectLocalModelProvider(indexProfile.embeddingProviderBaseUrl),
      baseUrl: indexProfile.embeddingProviderBaseUrl,
      logger: this.logger,
    });
    const retriever = new RetrievalService({
      embeddings,
      indexStore: new FileVectorIndexStore({
        folder: this.getVaultLocalPath(indexProfile.indexFolder),
        profileId: indexProfile.id,
        shardCount: indexProfile.shardCount,
        onPerformance: (event) => this.logger.logIndexingPerformance(event),
      }),
      embeddingModel: indexProfile.embeddingModel,
      keywordCorpus: [],
    });
    const result = await retriever.search(options.query, {
      limit: options.limit,
      includeWebResults: false,
      minScore: options.minScore,
      fileExtensions: options.extension ? [options.extension] : undefined,
    });

    return result.chunks;
  }

  private createIndexingService(onProgress: (state: IndexingState) => void): IndexingService {
    const indexProfile = getActiveIndexProfile(this.settings);
    const embeddings = new EmbeddingClient({
      provider: detectLocalModelProvider(indexProfile.embeddingProviderBaseUrl),
      baseUrl: indexProfile.embeddingProviderBaseUrl,
      logger: this.logger,
    });

    return new IndexingService({
      files: new ObsidianVaultFileProvider(this.app.vault),
      extractors: [
        new MarkdownExtractor({
          includeFolders: indexProfile.includeFolders,
          excludeGlobs: indexProfile.excludeGlobs,
          maxChunkLength: indexProfile.chunkSize,
          chunkOverlap: indexProfile.chunkOverlap,
        }),
        new TextExtractor({
          maxChunkLength: indexProfile.chunkSize,
          chunkOverlap: indexProfile.chunkOverlap,
        }),
        new PdfExtractor({
          maxChunkLength: indexProfile.pdfChunkSize,
          chunkOverlap: indexProfile.pdfChunkOverlap,
        }),
        new EpubExtractor({
          maxChunkLength: indexProfile.chunkSize,
          chunkOverlap: indexProfile.chunkOverlap,
        }),
        new Fb2Extractor({
          maxChunkLength: indexProfile.chunkSize,
          chunkOverlap: indexProfile.chunkOverlap,
        }),
        new DocxExtractor({
          maxChunkLength: indexProfile.chunkSize,
          chunkOverlap: indexProfile.chunkOverlap,
        }),
      ],
      embeddings,
      indexStore: new FileVectorIndexStore({
        folder: this.getVaultLocalPath(indexProfile.indexFolder),
        profileId: indexProfile.id,
        shardCount: indexProfile.shardCount,
        onPerformance: (event) => this.logger.logIndexingPerformance(event),
      }),
      embeddingModel: indexProfile.embeddingModel,
      includeFolders: indexProfile.includeFolders,
      excludeGlobs: indexProfile.excludeGlobs,
      batchSize: indexProfile.embeddingBatchSize,
      onProgress,
      logger: this.logger,
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
