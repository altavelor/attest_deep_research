import { join } from "path";

import { FileSystemAdapter, Notice, Plugin, TFile, Vault, requestUrl } from "obsidian";

import { ChatModelClient } from "./client/chat/ChatModelClient";
import { FileChatStore } from "./chat/ChatStore";
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
import { FileVectorIndexStore, IndexProfile } from "./indexing/FileVectorIndexStore";
import { measureFolderSize } from "./indexing/indexSize";
import { RetrievalService } from "./retrieval/RetrievalService";
import { QueryExpansionService } from "./retrieval/QueryExpansionService";
import { ResearchService } from "./research/ResearchService";
import { IxplorerSettingTab } from "./settings/SettingsTab";
import { PluginDebugLogger } from "./settings/debugLogger";
import {
  DEFAULT_SETTINGS,
  ChatModelProfile,
  EmbeddingModelProfile,
  IxplorerSettings,
  ServerProfile,
  getActiveIndexProfile,
  migrateSettings,
  normalizeSettingsState,
  resolveChatModelProfile,
  resolveEmbeddingModelProfile,
  resolveServerProfile,
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
  async onload(): Promise<void> {
    await this.loadSettings();
    void this.indexing.refreshIndexSize();
    this.registerView(
      IXPLORER_CHAT_VIEW_TYPE,
      (leaf) =>
        new IxplorerChatView(leaf, {
          createResearchService: (chatModelProfileId) =>
            this.createResearchService(chatModelProfileId),
          getIndexingState: () => this.indexing.getState(),
          subscribeToIndexingState: (listener) => this.indexing.subscribe(listener),
          indexingActions: {
            start: () => this.indexing.start(),
            pause: () => this.indexing.pause(),
            resume: () => this.indexing.resume(),
            rebuild: () => this.indexing.rebuild(),
          },
          isWebSearchEnabled: () => this.settings.duckDuckGoEnabled,
          getChatModel: () =>
            resolveChatModelProfile(this.settings, this.settings.activeChatModelProfileId)?.name ??
            "",
          setChatModel: async (modelProfileId) => {
            this.settings.activeChatModelProfileId = modelProfileId.trim();
            normalizeSettingsState(this.settings);
            await this.saveSettings();
          },
          getAvailableChatModels: () =>
            this.settings.chatModelProfiles
              .filter((profile) => profile.isSuspended !== true)
              .map((profile) => profile.name),
          getChatModelProfiles: () =>
            this.settings.chatModelProfiles.map((profile) => ({
              id: profile.id,
              name: profile.name,
              isSuspended: profile.isSuspended === true,
            })),
          getIndexProfiles: () =>
            this.settings.indexProfiles.map((profile) => ({ id: profile.id, name: profile.name })),
          searchIndex: (options) => this.searchIndex(options),
          listSavedChats: () => this.createChatStore().listChats(),
          loadSavedChat: (id) => this.createChatStore().loadChat(id),
          saveChat: (input) => this.createChatStore().saveChat(input),
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
    normalizeSettingsState(this.settings);
    await this.saveData(this.settings);
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

  private createResearchService(chatModelProfileId?: string): ResearchService {
    const indexProfile = getActiveIndexProfile(this.settings);
    const chatProfile = this.requireChatModelProfile(chatModelProfileId);
    const chatServer = this.requireServerProfile(chatProfile.serverProfileId);

    return new ResearchService({
      retriever: this.createRetrieverForProfile(indexProfile),
      chatModel: this.createChatModelClient(chatServer),
      chatModelName: chatProfile.modelName,
      chatOptions: {
        temperature: chatProfile.temperature,
        maxTokens: chatProfile.maxTokens,
      },
      queryExpansion: this.createQueryExpansionService(chatProfile, chatServer),
      searchProvider: this.createSearchProvider(),
    });
  }

  private createChatStore(): FileChatStore {
    return new FileChatStore({
      folder: this.getVaultLocalPath(".ixplorer/chats"),
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
    const retriever = this.createRetrieverForProfile(indexProfile);
    const chatProfile = resolveChatModelProfile(
      this.settings,
      this.settings.activeChatModelProfileId,
    );
    const chatServer = chatProfile
      ? resolveServerProfile(this.settings, chatProfile.serverProfileId)
      : undefined;
    const queryExpansion =
      chatProfile && chatServer
        ? this.createQueryExpansionService(chatProfile, chatServer)
        : undefined;
    const languageInventory = await retriever.getLanguageInventory();
    const queryVariants = queryExpansion
      ? await queryExpansion.buildVariants({
        query: options.query,
        languageInventory,
      })
      : [];
    const result = await retriever.search(options.query, {
      limit: options.limit,
      includeWebResults: false,
      minScore: options.minScore,
      fileExtensions: options.extension ? [options.extension] : undefined,
      queryVariants: queryVariants.length > 0 ? queryVariants : undefined,
    });

    return result.chunks;
  }

  private createIndexingService(onProgress: (state: IndexingState) => void): IndexingService {
    const indexProfile = getActiveIndexProfile(this.settings);
    const embeddingProfile = this.requireEmbeddingModelProfile(indexProfile.embeddingModelProfileId);

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
      embeddings: this.createEmbeddingClientForProfile(embeddingProfile),
      indexStore: this.createVectorIndexStoreForProfile(indexProfile),
      embeddingModel: embeddingProfile.modelName,
      includeFolders: indexProfile.includeFolders,
      excludeGlobs: indexProfile.excludeGlobs,
      batchSize: indexProfile.embeddingBatchSize,
      onProgress,
      logger: this.logger,
    });
  }

  private createEmbeddingClientForProfile(embeddingProfile: EmbeddingModelProfile): EmbeddingClient {
    const server = this.requireServerProfile(embeddingProfile.serverProfileId);
    return new EmbeddingClient({
      apiFormat: server.apiFormat,
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      logger: this.logger,
    });
  }

  private createVectorIndexStoreForProfile(indexProfile: IndexProfile): FileVectorIndexStore {
    return new FileVectorIndexStore({
      folder: this.getVaultLocalPath(indexProfile.indexFolder),
      profileId: indexProfile.id,
      shardCount: indexProfile.shardCount,
      onPerformance: (event) => this.logger.logIndexingPerformance(event),
    });
  }

  private createRetrieverForProfile(indexProfile: IndexProfile): RetrievalService {
    const embeddingProfile = this.requireEmbeddingModelProfile(indexProfile.embeddingModelProfileId);
    return new RetrievalService({
      embeddings: this.createEmbeddingClientForProfile(embeddingProfile),
      indexStore: this.createVectorIndexStoreForProfile(indexProfile),
      embeddingModel: embeddingProfile.modelName,
      keywordCorpus: [],
    });
  }

  private createChatModelClient(server: ServerProfile): ChatModelClient {
    return new ChatModelClient({
      apiFormat: server.apiFormat,
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      logger: this.logger,
    });
  }

  private createQueryExpansionService(
    chatProfile: ChatModelProfile,
    server: ServerProfile,
  ): QueryExpansionService {
    return new QueryExpansionService({
      chatModel: this.createChatModelClient(server),
      chatModelName: chatProfile.modelName,
      chatOptions: {
        temperature: chatProfile.temperature,
        maxTokens: chatProfile.maxTokens,
      },
    });
  }

  private requireChatModelProfile(profileId?: string): ChatModelProfile {
    const profile = resolveChatModelProfile(this.settings, profileId);
    if (!profile) {
      throw new Error("Select a chat model profile before asking a question.");
    }
    return profile;
  }

  private requireEmbeddingModelProfile(profileId?: string): EmbeddingModelProfile {
    const profile = resolveEmbeddingModelProfile(this.settings, profileId);
    if (!profile) {
      throw new Error("Select an embedding model profile before using this index.");
    }
    return profile;
  }

  private requireServerProfile(profileId: string): ServerProfile {
    const profile = resolveServerProfile(this.settings, profileId);
    if (!profile) {
      throw new Error("The selected server profile is unavailable.");
    }
    return profile;
  }

  private createSearchProvider(): DuckDuckGoSearchProvider | undefined {
    if (!this.settings.duckDuckGoEnabled) {
      return undefined;
    }

    return new DuckDuckGoSearchProvider({ fetch: obsidianRequestFetch, logger: this.logger });
  }

  private getVaultLocalPath(path: string): string {
    const adapter = this.app.vault.adapter;

    if (adapter instanceof FileSystemAdapter) {
      return join(adapter.getBasePath(), path);
    }

    return path;
  }
}

const obsidianRequestFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const response = await requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: normalizeFetchHeaders(init?.headers),
    body: normalizeFetchBody(init?.body),
    throw: false,
  });

  return new Response(response.arrayBuffer, {
    status: response.status,
    headers: response.headers,
  });
};

function normalizeFetchHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const entries: Record<string, string> = {};
    headers.forEach((value, key) => {
      entries[key] = value;
    });
    return entries;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

function normalizeFetchBody(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
  if (typeof body === "string" || body instanceof ArrayBuffer) {
    return body;
  }

  return undefined;
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
