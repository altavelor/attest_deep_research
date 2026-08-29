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
import { reasoningVerified, toolsVerified } from "@adapters/settings";
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
import {
  ATTEST_CHAT_VIEW_TYPE,
  AttestChatView,
  type AttestChatCommandAction,
} from "./ui/chat/AttestChatView";
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
import { ATTEST_COMMAND_IDS, registerAttestCommands } from "./commands";
import { OnboardingModal } from "./ui/onboarding";
import { applyOnboardingResult, onboardingPrefill } from "@adapters/settings";
import type { AppliedOnboarding, OnboardingResult } from "@adapters/settings";
import { fetchAvailableModels, verifyEmbeddingCapability } from "@adapters/settings";
import { resolveProviderFetch } from "./modelProviderRuntime";
import { createChatSessionManager } from "./composition/chatSessionFactory";
import type { ChatSessionManager } from "@application/use-cases/chat";

export default class AttestPlugin extends Plugin {
  readonly defaultSettings = DEFAULT_SETTINGS;
  settings: AttestSettings = DEFAULT_SETTINGS;
  readonly logger = new PluginDebugLogger({ getSettings: () => this.settings });
  private readonly pdfTextCache = new PdfTextCache();
  private translator: UiTranslator = createTranslator(DEFAULT_LOCALE);
  private onboardingModal?: OnboardingModal;
  private unloaded = false;

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

  private chatSessionManager?: ChatSessionManager;
  private warmCaches?: VaultWarmCaches;
  private vaultFileSystem?: FileSystemPort;
  private mobileIndexingLifecycle?: MobileIndexingLifecycle;
  private ribbonIcon?: HTMLElement;
  private chatActivation?: Promise<AttestChatView>;

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

  /** Chat sessions outlive every chat view, so the plugin owns their manager. */
  get chatSessions(): ChatSessionManager {
    this.chatSessionManager ??= createChatSessionManager({
      repository: this.createChatStore(),
      createResearchService: (chatModelProfileId, indexProfileId, searchMode) =>
        createResearchService(this.composition, chatModelProfileId, indexProfileId, searchMode),
      persistDiagnostics: () => this.settings.debugMode,
      logError: (error) => this.logger.logError(error, { url: "chat:session" }),
    });
    return this.chatSessionManager;
  }

  async onload(): Promise<void> {
    this.unloaded = false;
    await this.loadSettings();
    await this.recoverStaleChatRuns();
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
          createResearchService: (chatModelProfileId, indexProfileId, searchMode) =>
            createResearchService(this.composition, chatModelProfileId, indexProfileId, searchMode),
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
              supportsAgentMode:
                reasoningVerified(profile.reasoningCapabilities) && toolsVerified(profile),
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
          sessions: this.chatSessions,
          listSavedChats: () => this.createChatStore().listChats(),
          loadSavedChat: (id) => this.createChatStore().loadChat(id),
          renameSavedChat: async (id, title) => {
            await this.createChatStore().renameChat(id, title);
          },
          setSavedChatFavorite: async (id, isFavorite) => {
            await this.createChatStore().setChatFavorite(id, isFavorite);
          },
          getTranslator: () => this.translator,
          logError: (error) => this.composition.logger.logError(error, { url: "chat:research" }),
          isDebugMode: () => this.settings.debugMode,
          shouldIncludeActiveFileContext: () =>
            this.settings.newChatDefaults.includeActiveFileContext,
        }),
    );
    this.registerCommands();
    this.ribbonIcon = this.addRibbonIcon(
      "bot-message-square",
      this.translate("command.openChat"),
      () => {
        void this.activateChatView().catch((error) => new Notice(toUserMessage(error)));
      },
    );
    this.addSettingTab(new AttestSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.openOnboardingOnFirstRun());
  }

  /**
   * Shows the first-run wizard once, and only for a vault that has never had a
   * server profile: an upgrade from a configured installation must not be
   * interrupted by it.
   */
  private openOnboardingOnFirstRun(): void {
    if (
      this.unloaded ||
      this.settings.onboardingCompleted ||
      this.settings.serverProfiles.length > 0
    ) {
      return;
    }

    this.openOnboarding();
  }

  openOnboarding(onClosed?: () => void): void {
    if (this.unloaded || this.onboardingModal) {
      return;
    }

    const modal = new OnboardingModal(this.app, {
      t: this.translate,
      getDirection: () => this.translator.direction,
      isMobile: Platform.isMobile,
      prefill: onboardingPrefill(this.settings),
      fetchModels: (server) =>
        fetchAvailableModels(server, {
          logger: this.logger,
          fetch: resolveProviderFetch(server, "buffered", Platform.isMobile),
        }),
      verifyEmbedding: (server, modelName) =>
        verifyEmbeddingCapability(server, modelName, {
          logger: this.logger,
          fetch: resolveProviderFetch(server, "buffered", Platform.isMobile),
        }),
      onComplete: (result) => this.completeOnboarding(result),
      onStartIndexing: (indexProfileId, embeddingModelProfileId) => {
        /*
         * A first build, not an incremental pass: the index folder may still
         * hold content from an earlier setup, and only a rebuild rewrites the
         * image manifest that carries the index version. An incremental run
         * over leftovers leaves the finished index flagged for reindexing.
         */
        void this.runIndexPlan(indexProfileId, {
          mode: "rebuild",
          embedding: { embeddingModelProfileId },
        }).catch((error) => new Notice(toUserMessage(error)));
      },
      watchIndexing: (indexProfileId, listener) =>
        this.indexing.subscribe(indexProfileId, listener),
      onOpenChat: async () => {
        await this.activateChatView();
      },
      onSkip: async () => {
        const nextSettings = structuredClone(this.settings);
        nextSettings.onboardingCompleted = true;
        normalizeSettingsState(nextSettings);
        await this.saveData(nextSettings);
        if (this.unloaded) {
          return;
        }
        this.settings = nextSettings;
        this.openSettingsTab();
      },
    });
    const close = modal.onClose.bind(modal);
    modal.onClose = () => {
      close();
      if (this.onboardingModal === modal) {
        this.onboardingModal = undefined;
      }
      onClosed?.();
    };
    this.onboardingModal = modal;
    modal.open();
  }

  private async completeOnboarding(result: OnboardingResult): Promise<AppliedOnboarding> {
    const nextSettings = structuredClone(this.settings);
    const applied = applyOnboardingResult(nextSettings, result);
    normalizeSettingsState(nextSettings);
    await this.saveData(nextSettings);
    if (!this.unloaded) {
      this.settings = nextSettings;
    }
    return applied;
  }

  onunload(): void {
    this.unloaded = true;
    this.onboardingModal?.close();
    this.onboardingModal = undefined;
    void this.chatSessionManager?.dispose();
    this.chatSessionManager = undefined;
    this.mobileIndexingLifecycle?.dispose();
    this.mobileIndexingLifecycle = undefined;
    this.warmCaches?.dispose();
    this.warmCaches = undefined;
    this.ribbonIcon = undefined;
  }

  /**
   * Startup recovery. Stale queued, running, or stopping runs left by an
   * abnormal shutdown become interrupted before any view or run can observe
   * them; a failure here must not block plugin load.
   */
  private async recoverStaleChatRuns(): Promise<void> {
    try {
      await this.chatSessions.normalizeStaleChats();
    } catch (error) {
      this.logger.logError(error, { url: "chat:recovery" });
    }
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
    for (const commandId of ATTEST_COMMAND_IDS) this.removeCommand(commandId);
    this.registerCommands();
    const ribbonLabel = this.translate("command.openChat");
    this.ribbonIcon?.setAttr("aria-label", ribbonLabel);
    this.ribbonIcon?.setAttr("title", ribbonLabel);
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
    registerAttestCommands({
      addCommand: (command) => this.addCommand(command),
      t: this.translate,
      openChat: async () => {
        await this.activateChatView();
      },
      runChatCommand: (action) => this.runChatCommand(action),
      updateActiveIndex: () => this.updateActiveIndex(),
      runSetup: () => this.openOnboarding(),
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

  async activateChatView(): Promise<AttestChatView> {
    if (!this.chatActivation) {
      this.chatActivation = this.activateChatViewOnce().finally(() => {
        this.chatActivation = undefined;
      });
    }
    return this.chatActivation;
  }

  private async activateChatViewOnce(): Promise<AttestChatView> {
    const existingLeaf = this.app.workspace.getLeavesOfType(ATTEST_CHAT_VIEW_TYPE)[0];
    const leaf =
      existingLeaf ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);

    if (!existingLeaf) {
      await leaf.setViewState({
        type: ATTEST_CHAT_VIEW_TYPE,
        active: true,
      });
    }
    await this.app.workspace.revealLeaf(leaf);
    this.warmVaultCaches();
    if (!(leaf.view instanceof AttestChatView)) {
      throw new Error("Attest chat view could not be activated.");
    }
    return leaf.view;
  }

  private async runChatCommand(action: AttestChatCommandAction): Promise<void> {
    const view = await this.activateChatView();
    await view.runCommand(action);
  }

  private async updateActiveIndex(): Promise<void> {
    await this.indexing.start(getActiveIndexProfile(this.settings).id);
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
