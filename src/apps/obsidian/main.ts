import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import { join } from "path";

import { FileChatRepository as FileChatStore } from "@adapters/filesystem/FileChatRepository";
import { PdfTextCache } from "@adapters/extractors";
import { IndexSourceReportItem } from "@adapters/indexing";
import { EnrichmentProfileController } from "@adapters/indexing";
import { IndexingProfileController } from "@adapters/indexing";
import { measureFolderSize } from "@adapters/indexing";
import { IxplorerSettingTab } from "./ui/SettingsTab";
import { PluginDebugLogger } from "@adapters/settings";
import { DEFAULT_SETTINGS } from "@adapters/settings";
import { normalizeSettingsState } from "@adapters/settings";
import { readSettings } from "@adapters/settings";
import {
  getActiveIndexProfile,
  resolveChatModelProfile,
  resolveServerProfile,
} from "@adapters/settings";
import { IxplorerSettings } from "@adapters/settings";
import { toUserMessage } from "@core/errors";
import { WebSourceHealthTracker } from "@application/web";
import { IXPLORER_CHAT_VIEW_TYPE, IxplorerChatView } from "./ui/chat/IxplorerChatView";
import { refreshIndexDescriptionAfterRun } from "@adapters/indexing";
import { CompositionContext, createDocumentMetadataStoreForProfile, createEnrichmentService, createIndexingService, createQueryExpansionService, createResearchService, createRetrieverForProfile, createVectorIndexStoreForProfile } from "./composition/factories";
import type { SourceDocumentMetadata } from "@application/ports";
import type { IndexRunPlan } from "./ui/settings/IndexRunModal";
import { requireIndexProfile, resolveIndexProfileForUse } from "./composition/profileResolvers";

export default class IxplorerPlugin extends Plugin {
  readonly defaultSettings = DEFAULT_SETTINGS;
  settings: IxplorerSettings = DEFAULT_SETTINGS;
  readonly logger = new PluginDebugLogger({ getSettings: () => this.settings });
  private readonly pdfTextCache = new PdfTextCache();
  /**
   * Enrichment (SPEC-corpus R3) is user-triggered per index profile from the
   * settings row — it spends chat-model tokens per document, so it never runs
   * as an indexing side effect. Incremental by contentHash — re-runs are cheap.
   */
  readonly enrichment = new EnrichmentProfileController({
    createService: (profileId, chatModelProfileId) =>
      createEnrichmentService(this.composition, profileId, chatModelProfileId),
    onComplete: async (profileId) => {
      const profile = this.settings.indexProfiles.find((candidate) => candidate.id === profileId);
      if (!profile) {
        return;
      }
      profile.lastEnrichedAt = new Date().toISOString();
      profile.updatedAt = profile.lastEnrichedAt;
      await this.saveSettings();
    },
    onError: (error) => new Notice(toUserMessage(error)),
  });
  readonly indexing = new IndexingProfileController({
    getProfile: (profileId) =>
      this.settings.indexProfiles.find((profile) => profile.id === profileId),
    createService: (profileId, onProgress) =>
      createIndexingService(this.composition, profileId, onProgress),
    measureIndexSize: (profileId) =>
      measureFolderSize(
        this.getVaultLocalPath(requireIndexProfile(this.settings, profileId).indexFolder),
      ),
    onError: (error) => new Notice(toUserMessage(error)),
    onComplete: async (profileId, state) => {
      const profile = this.settings.indexProfiles.find((candidate) => candidate.id === profileId);
      if (!profile) {
        return;
      }
      const generatedAt = new Date().toISOString();
      if (state.indexChanged === true && profile.indexDescription) {
        profile.indexDescription = { ...profile.indexDescription, status: "stale" };
      }
      profile.indexDescription = await refreshIndexDescriptionAfterRun(
        profile,
        state,
        () => createVectorIndexStoreForProfile(this.composition, profile).loadIndexDescriptionSource(),
        generatedAt,
      );
      profile.lastIndexedAt = state.lastIndexedAt;
      // indexedFiles — счётчик ЭТОГО прогона: при инкрементальном update
      // актуальные файлы уходят в skippedFiles. Итог в индексе = сумма обоих.
      profile.indexedFileCount = state.indexedFiles + state.skippedFiles;
      profile.indexSizeBytes = state.indexSizeBytes;
      profile.updatedAt = new Date().toISOString();
      await this.saveSettings();
    },
  });

  readonly webSourceHealth = new WebSourceHealthTracker();

  /** Collaborators the composition factories need from this plugin host. */
  private get composition(): CompositionContext {
    return {
      app: this.app,
      logger: this.logger,
      pdfTextCache: this.pdfTextCache,
      webSourceHealth: this.webSourceHealth,
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      getVaultLocalPath: (path) => this.getVaultLocalPath(path),
      getIndexingState: (profileId) => this.indexing.getState(profileId),
    };
  }

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
            createResearchService(this.composition, chatModelProfileId, indexProfileId),
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
          isWebSearchEnabled: () => this.settings.webSources.some((profile) => profile.enabled),
          getChatModel: () =>
            resolveChatModelProfile(this.settings, this.settings.activeChatModelProfileId)?.name ??
            "",
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
          getDefaultChatModelProfileId: () => this.settings.activeChatModelProfileId,
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
          renameSavedChat: async (id, title) => {
            await this.createChatStore().renameChat(id, title);
          },
          deleteSavedChat: (id) => this.createChatStore().deleteChat(id),
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
    this.settings = readSettings(await this.loadData());
    this.logger.logConfiguration("initial-load", this.settings);
  }

  async saveSettings(): Promise<void> {
    normalizeSettingsState(this.settings);
    await this.saveData(this.settings);
  }

  markIndexStale(profileId = this.settings.activeIndexProfileId): void {
    this.indexing.markStale(profileId);
  }


  async loadIndexReport(profileId: string): Promise<IndexSourceReportItem[]> {
    return createVectorIndexStoreForProfile(
      this.composition,
      requireIndexProfile(this.settings, profileId),
    ).loadSourceReport();
  }

  async loadIndexMetadata(profileId: string): Promise<SourceDocumentMetadata[]> {
    return createDocumentMetadataStoreForProfile(
      this.composition,
      requireIndexProfile(this.settings, profileId),
    ).list();
  }

  /**
   * Unified index action (settings row → IndexRunModal): runs the enabled
   * sections sequentially — indexing first, then metadata enrichment — with no
   * extra confirmations. A rebuild wipes the index folder including metadata
   * sidecars (store.clear removes the whole folder).
   */
  async runIndexPlan(profileId: string, plan: IndexRunPlan): Promise<void> {
    const profile = requireIndexProfile(this.settings, profileId);

    if (plan.embedding) {
      if (plan.embedding.embeddingModelProfileId !== profile.embeddingModelProfileId) {
        profile.embeddingModelProfileId = plan.embedding.embeddingModelProfileId;
        profile.updatedAt = new Date().toISOString();
        await this.saveSettings();
      }
      const state =
        plan.mode === "rebuild"
          ? await this.indexing.rebuild(profileId)
          : await this.indexing.start(profileId);
      // Пауза/ошибка индексации: метаданные по недоиндексированному корпусу не извлекаем.
      if (state.status === "paused" || state.status === "error") {
        return;
      }
    }

    if (plan.metadata) {
      // lastEnrichedAt пишет onComplete контроллера — до финального
      // уведомления подписчиков, иначе строка мигает «Stale metadata».
      await this.enrichment.start(profileId, plan.metadata.chatModelProfileId, {
        force: plan.metadata.force,
      });
    }
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
    const indexProfile = resolveIndexProfileForUse(this.settings, options.profileId);
    const retriever = createRetrieverForProfile(this.composition, indexProfile);
    const chatProfile = resolveChatModelProfile(
      this.settings,
      this.settings.activeChatModelProfileId,
    );
    const chatServer = chatProfile
      ? resolveServerProfile(this.settings, chatProfile.serverProfileId)
      : undefined;
    const queryExpansion =
      chatProfile && chatServer
        ? createQueryExpansionService(this.composition, chatProfile, chatServer)
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

  private getVaultLocalPath(path: string): string {
    const adapter = this.app.vault.adapter;

    if (adapter instanceof FileSystemAdapter) {
      return join(adapter.getBasePath(), path);
    }

    return path;
  }

}
