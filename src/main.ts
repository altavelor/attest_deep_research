import { join } from "path";

import { FileSystemAdapter, Notice, Plugin, requestUrl } from "obsidian";

import { ChatModelClient } from "./client/chat/ChatModelClient";
import { FileChatStore } from "./chat/ChatStore";
import { EmbeddingClient } from "./client/embeddings/EmbeddingClient";
import { DocxExtractor } from "./extractors/DocxExtractor";
import { EpubExtractor } from "./extractors/EpubExtractor";
import { Fb2Extractor } from "./extractors/Fb2Extractor";
import { MarkdownExtractor } from "./extractors/MarkdownExtractor";
import { PdfExtractor } from "./extractors/PdfExtractor";
import { PdfTextCache } from "./extractors/PdfTextCache";
import { TextExtractor } from "./extractors/TextExtractor";
import {
  IndexingService,
  IndexingState,
  IndexSourceReportItem,
} from "./indexing/IndexingService";
import { IndexingProfileController } from "./indexing/IndexingProfileController";
import { FileVectorIndexStore, IndexProfile } from "./indexing/FileVectorIndexStore";
import { measureFolderSize } from "./indexing/indexSize";
import { ObsidianVaultFileProvider } from "./indexing/ObsidianVaultFileProvider";
import { RetrievalService } from "./retrieval/RetrievalService";
import { QueryExpansionService } from "./retrieval/QueryExpansionService";
import { ContextAssembler } from "./research/ContextAssembler";
import { DEFAULT_GRAPH_CONTEXT_LIMITS } from "./research/GraphContext";
import { ObsidianContextFileProvider } from "./research/ObsidianContextFileProvider";
import { ObsidianGraphContextProvider } from "./research/ObsidianGraphContextProvider";
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
  private readonly pdfTextCache = new PdfTextCache();
  readonly indexing = new IndexingProfileController({
    getProfile: (profileId) =>
      this.settings.indexProfiles.find((profile) => profile.id === profileId),
    createService: (profileId, onProgress) => this.createIndexingService(profileId, onProgress),
    measureIndexSize: (profileId) =>
      measureFolderSize(this.getVaultLocalPath(this.requireIndexProfile(profileId).indexFolder)),
    onError: (error) => new Notice(toUserMessage(error)),
    onComplete: async (profileId, state) => {
      const profile = this.settings.indexProfiles.find((candidate) => candidate.id === profileId);
      if (!profile) {
        return;
      }
      profile.lastIndexedAt = state.lastIndexedAt;
      profile.indexedFileCount = state.indexedFiles;
      profile.indexSizeBytes = state.indexSizeBytes;
      profile.updatedAt = new Date().toISOString();
      await this.saveSettings();
    },
  });
  async onload(): Promise<void> {
    await this.loadSettings();
    if (getActiveIndexProfile(this.settings).isSuspended !== true) {
      void this.indexing.refreshIndexSize(this.settings.activeIndexProfileId);
    }
    this.registerView(
      IXPLORER_CHAT_VIEW_TYPE,
      (leaf) =>
        new IxplorerChatView(leaf, {
          createResearchService: (chatModelProfileId, indexProfileId) =>
            this.createResearchService(chatModelProfileId, indexProfileId),
          getIndexingState: (indexProfileId) =>
            this.indexing.getState(indexProfileId ?? this.settings.activeIndexProfileId),
          subscribeToIndexingState: (indexProfileId, listener) =>
            this.indexing.subscribe(indexProfileId ?? this.settings.activeIndexProfileId, listener),
          indexingActions: {
            start: (indexProfileId) =>
              this.indexing.start(indexProfileId ?? this.settings.activeIndexProfileId),
            pause: (indexProfileId) =>
              this.indexing.pause(indexProfileId ?? this.settings.activeIndexProfileId),
            resume: (indexProfileId) =>
              this.indexing.resume(indexProfileId ?? this.settings.activeIndexProfileId),
            rebuild: (indexProfileId) =>
              this.indexing.rebuild(indexProfileId ?? this.settings.activeIndexProfileId),
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
              contextLength: profile.capabilities?.contextLength,
              maxTokens: profile.maxTokens,
              isSuspended: profile.isSuspended === true,
            })),
          getDefaultIndexProfileId: () => this.settings.activeIndexProfileId,
          getIndexProfiles: () =>
            this.settings.indexProfiles.map((profile) => ({
              id: profile.id,
              name: profile.name,
              isSuspended: profile.isSuspended === true,
              isIndexed: Boolean(profile.lastIndexedAt),
            })),
          searchIndex: (options) => this.searchIndex(options),
          listSavedChats: () => this.createChatStore().listChats(),
          loadSavedChat: (id) => this.createChatStore().loadChat(id),
          saveChat: (input) => this.createChatStore().saveChat(input),
          isChatIndexControlShown: () => this.settings.showChatIndexControl,
          isDebugMode: () => this.settings.debugMode,
          shouldIncludeActiveFileContext: () => this.settings.includeActiveFileContext,
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

  markIndexStale(profileId = this.settings.activeIndexProfileId): void {
    this.indexing.markStale(profileId);
  }

  async loadIndexReport(profileId: string): Promise<IndexSourceReportItem[]> {
    return this.createVectorIndexStoreForProfile(
      this.requireIndexProfile(profileId),
    ).loadSourceReport();
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

  private createResearchService(
    chatModelProfileId?: string,
    indexProfileId?: string,
  ): ResearchService {
    const indexProfile = this.resolveIndexProfile(indexProfileId);
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
      contextLimitTokens: chatProfile.capabilities?.contextLength,
      queryExpansion: this.createQueryExpansionService(chatProfile, chatServer),
      contextAssembler: new ContextAssembler({
        files: new ObsidianContextFileProvider(this.app.vault),
        extractors: this.createContextExtractorsForProfile(indexProfile),
        graph: new ObsidianGraphContextProvider(this.app.vault, this.app.metadataCache),
        retrieve: async () => [],
      }),
      graphContext: {
        enabled: this.settings.useLinkedNotes,
        includeBacklinks: this.settings.includeBacklinks,
        expandFilteredContextThroughLinks: this.settings.expandFilteredContextThroughLinks,
        depth: this.settings.graphContextDepth === 2 ? 2 : 1,
        limits: DEFAULT_GRAPH_CONTEXT_LIMITS,
      },
      evidencePlanner: {
        useWebWhenFreshnessNeeded: this.settings.useWebWhenFreshnessNeeded,
      },
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
    const indexProfile = this.resolveIndexProfile(options.profileId);
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

  private createIndexingService(
    profileId: string,
    onProgress: (state: IndexingState) => void,
  ): IndexingService {
    const indexProfile = this.requireIndexProfile(profileId);
    const embeddingProfile = this.requireEmbeddingModelProfile(
      indexProfile.embeddingModelProfileId,
    );

    return new IndexingService({
      files: new ObsidianVaultFileProvider(this.app.vault),
      extractors: this.createExtractorsForProfile(indexProfile),
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

  private createEmbeddingClientForProfile(
    embeddingProfile: EmbeddingModelProfile,
  ): EmbeddingClient {
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

  private createExtractorsForProfile(indexProfile: IndexProfile) {
    return [
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
        cache: this.pdfTextCache,
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
    ];
  }

  private createContextExtractorsForProfile(indexProfile: IndexProfile) {
    return [
      new MarkdownExtractor({
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
        cache: this.pdfTextCache,
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
    ];
  }

  private createRetrieverForProfile(indexProfile: IndexProfile): RetrievalService {
    const embeddingProfile = this.requireEmbeddingModelProfile(
      indexProfile.embeddingModelProfileId,
    );
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

  private resolveIndexProfile(profileId?: string): IndexProfile {
    const requested = profileId
      ? this.settings.indexProfiles.find(
          (profile) =>
            profile.id === profileId &&
            profile.isSuspended !== true &&
            Boolean(profile.lastIndexedAt),
        )
      : undefined;

    const active = getActiveIndexProfile(this.settings);
    if (active.isSuspended !== true && active.lastIndexedAt) {
      return requested ?? active;
    }

    const firstIndexed = this.settings.indexProfiles.find(
      (profile) => profile.isSuspended !== true && Boolean(profile.lastIndexedAt),
    );
    if (!requested && !firstIndexed) {
      throw new Error("Index this profile before using it in chat or search.");
    }

    return requested ?? firstIndexed!;
  }

  private requireIndexProfile(profileId: string): IndexProfile {
    const profile = this.settings.indexProfiles.find((candidate) => candidate.id === profileId);
    if (!profile || profile.isSuspended) {
      throw new Error("The selected index profile is unavailable.");
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
