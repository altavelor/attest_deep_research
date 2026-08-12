import { Notice, Platform, Plugin } from "obsidian";

import { FileChatRepository as FileChatStore } from "@adapters/filesystem/FileChatRepository";
import { PdfTextCache } from "@adapters/extractors";
import { IndexSourceReportItem } from "@adapters/indexing";
import { EnrichmentProfileController } from "@adapters/indexing";
import { IndexingProfileController } from "@adapters/indexing";
import { measureFolderSize } from "@adapters/indexing";
import { AttestSettingTab } from "./ui/SettingsTab";
import { PluginDebugLogger } from "@adapters/settings";
import { DEFAULT_SETTINGS } from "@adapters/settings";
import { normalizeSettingsState } from "@adapters/settings";
import { reasoningVerified } from "@adapters/settings";
import { readSettings } from "@adapters/settings";
import {
  getActiveIndexProfile,
  resolveChatModelProfile,
  resolveEmbeddingModelProfile,
  resolveServerProfile,
} from "@adapters/settings";
import { AttestSettings } from "@adapters/settings";
import { toUserMessage } from "@core/errors";
import { DEFAULT_LOCALE, resolveLocale } from "@core/i18n";
import { createTranslator } from "@adapters/i18n";
import type { Translate, UiTranslator } from "@adapters/i18n";
import { readObsidianLanguage } from "@adapters/obsidian/ObsidianLanguageProbe";
import { isWebSourceActive } from "@core/web";
import { WebSourceHealthTracker } from "@application/web";
import type { FileSystemPort } from "@application/ports";
import { ObsidianContextFileProvider } from "@adapters/obsidian/ObsidianContextFileProvider";
import { VaultFileSystem } from "@adapters/obsidian/VaultFileSystem";
import { VaultWarmCaches } from "./composition/VaultWarmCaches";
import { ATTEST_CHAT_VIEW_TYPE, AttestChatView } from "./ui/chat/AttestChatView";
import { refreshIndexDescriptionAfterRun } from "@adapters/indexing";
import {
  CompositionContext,
  createDocumentMetadataStoreForProfile,
  createDocumentSummaryStoreForProfile,
  createEnrichmentService,
  createIndexingService,
  createQueryExpansionService,
  createResearchService,
  createRetrieverForProfile,
  createVectorIndexStoreForProfile,
} from "./composition/factories";
import { createDocumentImageResolver } from "./composition/mediaFactory";
import type { SourceDocumentMetadata, SourceDocumentSummaries } from "@application/ports";
import type { IndexDescriptionSource, IndexProfile } from "@adapters/indexing";
import type { IndexRunPlan } from "./ui/settings/IndexRunModal";
import {
  indexSearchEmbedderWarning,
  requireIndexProfile,
  resolveIndexProfileForUse,
} from "./composition/profileResolvers";
import { MobileIndexingLifecycle } from "./indexing/MobileIndexingLifecycle";

export default class AttestPlugin extends Plugin {
  readonly defaultSettings = DEFAULT_SETTINGS;
  settings: AttestSettings = DEFAULT_SETTINGS;
  readonly logger = new PluginDebugLogger({ getSettings: () => this.settings });
  private readonly pdfTextCache = new PdfTextCache();
  private translator: UiTranslator = createTranslator(DEFAULT_LOCALE);

  /** Late-bound translator lookup so captured references never go stale. */
  readonly translate: Translate = (key, params) => this.translator.t(key, params);

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
      profile.indexDescription = await refreshIndexDescriptionAfterRun(
        profile,
        { indexChanged: true, lastIndexedAt: profile.lastIndexedAt },
        () => this.loadDescriptionSource(profile),
        profile.lastEnrichedAt,
      );
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
        this.fileSystem,
        requireIndexProfile(this.settings, this.translate, profileId).indexFolder,
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
        () => this.loadDescriptionSource(profile),
        generatedAt,
      );
      profile.lastIndexedAt = state.lastIndexedAt;
      if (state.indexVersion !== undefined) {
        profile.indexVersion = state.indexVersion;
      }
      profile.indexedFileCount = state.indexedFiles + state.skippedFiles;
      profile.indexSizeBytes = state.indexSizeBytes;
      profile.updatedAt = new Date().toISOString();
      this.warmCaches?.invalidateLanguageInventory();
      await this.saveSettings();
    },
  });

  readonly webSourceHealth = new WebSourceHealthTracker();

  private warmCaches?: VaultWarmCaches;
  private vaultFileSystem?: FileSystemPort;
  private mobileIndexingLifecycle?: MobileIndexingLifecycle;

  /** Opens the plugin's settings tab; used by in-chat notices that link to it. */
  openSettingsTab(): void {
    const setting = (
      this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }
    ).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  /** Collaborators the composition factories need from this plugin host. */
  private get composition(): CompositionContext {
    return {
      app: this.app,
      logger: this.logger,
      translator: this.translator,
      pdfTextCache: this.pdfTextCache,
      webSourceHealth: this.webSourceHealth,
      warmCaches: this.requireWarmCaches(),
      fileSystem: this.fileSystem,
      isMobile: Platform.isMobile,
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      getIndexingState: (profileId) => this.indexing.getState(profileId),
    };
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.warmCaches = new VaultWarmCaches(new ObsidianContextFileProvider(this.app.vault));
    if (Platform.isMobile) {
      this.mobileIndexingLifecycle = new MobileIndexingLifecycle({
        visibility: document,
        getBusyProfileId: () => this.indexing.getBusyProfileId(),
        getState: (profileId) => this.indexing.getState(profileId),
        pause: (profileId) => this.indexing.pause(profileId),
        resume: (profileId) => this.indexing.resume(profileId),
      });
      this.mobileIndexingLifecycle.start();
    }
    const invalidateWarmPaths = () => this.warmCaches?.invalidatePaths();
    this.registerEvent(this.app.vault.on("create", invalidateWarmPaths));
    this.registerEvent(this.app.vault.on("delete", invalidateWarmPaths));
    this.registerEvent(this.app.vault.on("rename", invalidateWarmPaths));
    const startupIndexProfile = getActiveIndexProfile(this.settings);
    if (startupIndexProfile.isSuspended !== true) {
      void this.indexing.refreshIndexSize(startupIndexProfile.id);
    }
    this.registerView(
      ATTEST_CHAT_VIEW_TYPE,
      (leaf) =>
        new AttestChatView(leaf, {
          createResearchService: (chatModelProfileId, indexProfileId) =>
            createResearchService(this.composition, chatModelProfileId, indexProfileId),
          isWebSearchEnabled: () =>
            this.settings.webSources.some((profile) => isWebSourceActive(profile)),
          getChatModel: () =>
            resolveChatModelProfile(this.settings, this.settings.newChatDefaults.chatModelProfileId)
              ?.name ?? "",
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
              supportsAgentMode: reasoningVerified(profile.reasoningCapabilities),
            })),
          getDefaultChatModelProfileId: () => this.settings.newChatDefaults.chatModelProfileId,
          getDefaultIndexProfileId: () => this.settings.newChatDefaults.indexProfileId,
          getDefaultSearchMode: () => this.settings.newChatDefaults.searchMode,
          getDefaultResearchMode: () => this.settings.newChatDefaults.researchMode,
          getIndexProfiles: () =>
            this.settings.indexProfiles.map((profile) => ({
              id: profile.id,
              name: profile.name,
              isSuspended: profile.isSuspended === true,
              isIndexed: Boolean(profile.lastIndexedAt),
              ...(profile.indexVersion !== undefined ? { indexVersion: profile.indexVersion } : {}),
            })),
          getIndexSearchEmbedderWarning: (indexProfileId) =>
            indexSearchEmbedderWarning(this.settings, this.translate, indexProfileId),
          openIndexSettings: () => this.openSettingsTab(),
          resolveDocumentImage: (documentPath, locator, contentHash) =>
            createDocumentImageResolver(this.composition).resolve(
              documentPath,
              locator,
              contentHash,
            ),
          searchIndex: (options) => this.searchIndex(options),
          listSavedChats: () => this.createChatStore().listChats(),
          loadSavedChat: (id) => this.createChatStore().loadChat(id),
          saveChat: (input) => this.createChatStore().saveChat(input),
          renameSavedChat: async (id, title) => {
            await this.createChatStore().renameChat(id, title);
          },
          setSavedChatFavorite: async (id, isFavorite) => {
            await this.createChatStore().setChatFavorite(id, isFavorite);
          },
          deleteSavedChat: (id) => this.createChatStore().deleteChat(id),
          getTranslator: () => this.translator,
          isDebugMode: () => this.settings.debugMode,
          shouldIncludeActiveFileContext: () =>
            this.settings.newChatDefaults.includeActiveFileContext,
        }),
    );
    this.registerCommands();
    this.addSettingTab(new AttestSettingTab(this.app, this));
  }

  onunload(): void {
    this.mobileIndexingLifecycle?.dispose();
    this.mobileIndexingLifecycle = undefined;
    this.warmCaches?.dispose();
    this.warmCaches = undefined;
  }

  /** Warm-up caches exist for the plugin's lifetime; factories run only after onload. */
  private requireWarmCaches(): VaultWarmCaches {
    if (!this.warmCaches) {
      this.warmCaches = new VaultWarmCaches(new ObsidianContextFileProvider(this.app.vault));
    }
    return this.warmCaches;
  }

  async loadSettings(): Promise<void> {
    this.settings = readSettings(await this.loadData());
    this.rebindTranslator();
    this.logger.logConfiguration("initial-load", this.settings);
  }

  /**
   * Applies a changed interface language: rebinds the translator and renames
   * the registered command without leaving the old registration behind.
   */
  applyUiLanguage(): void {
    this.rebindTranslator();
    this.removeCommand("open-attest-chat");
    this.registerCommands();
  }

  getTranslator(): UiTranslator {
    return this.translator;
  }

  private rebindTranslator(): void {
    this.translator = createTranslator(
      resolveLocale(this.settings.uiLanguage, readObsidianLanguage()),
    );
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-attest-chat",
      name: this.translate("command.openChat"),
      icon: "bot-message-square",
      callback: () => {
        void this.activateChatView();
      },
    });
  }

  async saveSettings(): Promise<void> {
    normalizeSettingsState(this.settings);
    await this.saveData(this.settings);
  }

  markIndexStale(profileId = getActiveIndexProfile(this.settings).id): void {
    this.indexing.markStale(profileId);
  }

  async loadIndexReport(profileId: string): Promise<IndexSourceReportItem[]> {
    return createVectorIndexStoreForProfile(
      this.composition,
      requireIndexProfile(this.settings, this.translate, profileId),
    ).loadSourceReport();
  }

  async loadIndexMetadata(profileId: string): Promise<SourceDocumentMetadata[]> {
    return createDocumentMetadataStoreForProfile(
      this.composition,
      requireIndexProfile(this.settings, this.translate, profileId),
    ).list();
  }

  async loadIndexSummaries(profileId: string): Promise<SourceDocumentSummaries[]> {
    return createDocumentSummaryStoreForProfile(
      this.composition,
      requireIndexProfile(this.settings, this.translate, profileId),
    ).list();
  }

  /** Deterministic description source + enrichment one-liners (R4). */
  private async loadDescriptionSource(profile: IndexProfile): Promise<IndexDescriptionSource> {
    const source = await createVectorIndexStoreForProfile(
      this.composition,
      profile,
    ).loadIndexDescriptionSource();
    const summaries = await createDocumentSummaryStoreForProfile(this.composition, profile).list();
    return {
      ...source,
      ...(summaries.length > 0
        ? {
            documentOneLiners: summaries.map((item) => ({
              path: item.sourcePath,
              oneLiner: item.document.oneLiner,
            })),
          }
        : {}),
    };
  }

  /**
   * Unified index action (settings row → IndexRunModal): runs the enabled
   * sections sequentially — indexing first, then metadata enrichment — with no
   * extra confirmations. A rebuild wipes the index folder including metadata
   * sidecars (store.clear removes the whole folder).
   */
  async runIndexPlan(profileId: string, plan: IndexRunPlan): Promise<void> {
    const profile = requireIndexProfile(this.settings, this.translate, profileId);

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
      if (state.status === "paused" || state.status === "error") {
        return;
      }
    }

    if (plan.metadata) {
      await this.enrichment.start(profileId, plan.metadata.chatModelProfileId, {
        force: plan.metadata.force,
      });
    }
  }

  async activateChatView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(ATTEST_CHAT_VIEW_TYPE)[0];
    const leaf =
      existingLeaf ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);

    await leaf.setViewState({
      type: ATTEST_CHAT_VIEW_TYPE,
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
    this.warmVaultCaches();
  }

  /** Pull question-independent inputs off the critical path of the first turn. */
  private warmVaultCaches(): void {
    const profile = getActiveIndexProfile(this.settings);
    const embeddingProfile = resolveEmbeddingModelProfile(
      this.settings,
      profile.embeddingModelProfileId,
    );
    const embeddingServer = embeddingProfile
      ? resolveServerProfile(this.settings, embeddingProfile.serverProfileId)
      : undefined;
    const warmCaches = this.requireWarmCaches();
    warmCaches.warm();
    if (profile.isSuspended === true || !embeddingProfile || !embeddingServer) {
      return;
    }
    warmCaches.warm(profile.id, createRetrieverForProfile(this.composition, profile));
  }

  refreshChatViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(ATTEST_CHAT_VIEW_TYPE)) {
      if (leaf.view instanceof AttestChatView) {
        leaf.view.redisplay();
      }
    }
  }

  private createChatStore(): FileChatStore {
    return new FileChatStore({
      fileSystem: this.fileSystem,
      folder: ".attest/chats",
    });
  }

  private async searchIndex(options: {
    profileId: string;
    query: string;
    limit: number;
    minScore?: number;
    extension?: string;
  }) {
    const indexProfile = resolveIndexProfileForUse(
      this.settings,
      this.translate,
      options.profileId,
    );
    const retriever = createRetrieverForProfile(this.composition, indexProfile);
    const chatProfile = resolveChatModelProfile(
      this.settings,
      this.settings.newChatDefaults.chatModelProfileId,
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

    return {
      chunks: result.chunks,
      ...(result.semanticError ? { semanticError: result.semanticError } : {}),
    };
  }

  private get fileSystem(): FileSystemPort {
    this.vaultFileSystem ??= new VaultFileSystem(this.app.vault.adapter);

    return this.vaultFileSystem;
  }
}
