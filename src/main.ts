import { join } from "path";

import { FileSystemAdapter, Notice, Plugin, requestUrl } from "obsidian";

import { ChatModelClient } from "./client/chat/ChatModelClient";
import { OpenAiResponsesClient } from "./client/chat/OpenAiResponsesClient";
import { ChatCompletionsRoundAdapter } from "./client/chat/ChatCompletionsRoundAdapter";
import { FallbackModelRoundProvider } from "./client/chat/FallbackModelRoundProvider";
import { FileChatStore } from "./chat/ChatStore";
import { EmbeddingClient } from "./client/embeddings/EmbeddingClient";
import { DocxExtractor } from "./extractors/DocxExtractor";
import { EpubExtractor } from "./extractors/EpubExtractor";
import { Fb2Extractor } from "./extractors/Fb2Extractor";
import { MarkdownExtractor } from "./extractors/MarkdownExtractor";
import { PdfExtractor } from "./extractors/PdfExtractor";
import { PdfTextCache } from "./extractors/PdfTextCache";
import { TextExtractor } from "./extractors/TextExtractor";
import { IndexingService, IndexingState, IndexSourceReportItem } from "./indexing/IndexingService";
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
import { NoteToolService } from "./research/tools/NoteTools";
import { ObsidianVaultWriter } from "./research/tools/ObsidianVaultWriter";
import { ResearchService } from "./research/ResearchService";
import { IxplorerSettingTab } from "./settings/SettingsTab";
import { PluginDebugLogger } from "./settings/debugLogger";
import { resolveToolCapabilities } from "./settings/toolCapabilities";
import { isResponsesCapabilityCurrent } from "./settings/responsesCapabilityProbe";
import { capabilityCacheKey, recordObservedReasoningFormat } from "./settings/modelCapabilityCache";
import type { ReasoningResponseFormat } from "./settings/modelCapabilityCache";
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
  resolveEffectiveChatApiProtocol,
  resolveEffectiveReasoning,
  resolveEffectiveTools,
  resolveServerProfile,
} from "./settings/settings";
import { IxplorerError, toUserMessage } from "./shared/errors";
import type { ModelRoundProvider } from "./shared/types";
import { IXPLORER_CHAT_VIEW_TYPE, IxplorerChatView } from "./ui/IxplorerChatView";
import { DuckDuckGoSearchProvider } from "./web/DuckDuckGoSearchProvider";
import {
  refreshIndexDescriptionAfterRun,
  resolveIndexDescriptionForPrompt,
} from "./indexing/IndexDescription";

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
      const generatedAt = new Date().toISOString();
      if (state.indexChanged === true && profile.indexDescription) {
        profile.indexDescription = { ...profile.indexDescription, status: "stale" };
      }
      profile.indexDescription = await refreshIndexDescriptionAfterRun(
        profile,
        state,
        () => this.createVectorIndexStoreForProfile(profile).loadIndexDescriptionSource(),
        generatedAt,
      );
      profile.lastIndexedAt = state.lastIndexedAt;
      profile.indexedFileCount = state.indexedFiles;
      profile.indexSizeBytes = state.indexSizeBytes;
      profile.updatedAt = new Date().toISOString();
      await this.saveSettings();
    },
  });
  async onload(): Promise<void> {
    await this.loadSettings();
    void this.migrateRemoveSkillsFolder();
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
    this.settings = migrateSettings(await this.loadData());
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
    const retriever = this.createRetrieverForProfile(indexProfile);
    const contextFiles = new ObsidianContextFileProvider(this.app.vault);
    const contextExtractors = this.createContextExtractorsForProfile(indexProfile);
    const toolResolution = resolveToolCapabilities(chatProfile.capabilities?.toolCalling);
    const toolsEnabled = resolveEffectiveTools(chatProfile);
    let effectiveProtocol = resolveEffectiveChatApiProtocol(chatProfile);
    if (
      effectiveProtocol === "responses" &&
      !isResponsesCapabilityCurrent(
        chatProfile.reasoningCapabilities,
        chatServer,
        chatProfile.modelName,
      )
    ) {
      effectiveProtocol = "chat-completions";
    }
    const reasoning = resolveEffectiveReasoning(chatProfile, effectiveProtocol);
    const modelRound = this.createResponsesRoundProvider(
      chatProfile,
      chatServer,
      effectiveProtocol,
      reasoning,
    );
    const capabilitySnapshot =
      this.settings.modelCapabilityCache[
      capabilityCacheKey({
        baseUrl: chatServer.baseUrl,
        apiKey: chatServer.apiKey,
        model: chatProfile.modelName,
        protocol: effectiveProtocol,
      })
      ];

    return new ResearchService({
      retriever,
      chatModel: this.createChatModelClient(chatServer, chatProfile),
      ...(modelRound ? { modelRound } : {}),
      reasoning,
      reasoningDiagnostics: {
        protocol: effectiveProtocol,
        capabilitySource: capabilitySnapshot?.source ?? chatProfile.reasoningCapabilities?.source,
        observedFormats: capabilitySnapshot?.reasoning.responseFormats,
        summaryAvailable: chatProfile.reasoningCapabilities?.summary === true,
      },
      chatModelName: chatProfile.modelName,
      chatOptions: {
        temperature: chatProfile.temperature,
        maxTokens: chatProfile.maxTokens,
      },
      contextLimitTokens: chatProfile.capabilities?.contextLength,
      queryExpansion: this.createQueryExpansionService(chatProfile, chatServer),
      contextAssembler: new ContextAssembler({
        files: contextFiles,
        extractors: contextExtractors,
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
      toolsEnabled,
      forceEagerResearch: this.settings.forceEagerResearch,
      toolCapabilities: toolResolution.capabilities,
      toolCapabilityProvenance: toolResolution.provenance,
      toolCapabilityProbeAudit: chatProfile.capabilities?.toolCalling?.probeAudit,
      apiFormat: chatServer.apiFormat,
      indexDescription: resolveIndexDescriptionForPrompt(indexProfile),
      getIndexStatus: () => {
        const state = this.indexing.getState(indexProfile.id);
        return {
          status: state.status,
          available: Boolean(indexProfile.lastIndexedAt || state.indexedFiles > 0),
          isStale: state.isStale,
          indexedFiles: state.indexedFiles,
          ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
        };
      },
      noteTools: toolsEnabled
        ? new NoteToolService({
          files: contextFiles,
          extractors: contextExtractors,
          getActiveFilePath: () => this.app.workspace.getActiveFile()?.path,
          writer: chatProfile.noteMutationAccess
            ? new ObsidianVaultWriter(this.app)
            : undefined,
          noteMutationAccess: chatProfile.noteMutationAccess,
        })
        : undefined,
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

  private createChatModelClient(
    server: ServerProfile,
    profile?: ChatModelProfile,
  ): ChatModelClient {
    return new ChatModelClient({
      apiFormat: server.apiFormat,
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      logger: this.logger,
      ...(profile
        ? {
          onReasoningObserved: (observation: {
            protocol: "chat-completions";
            dialect: string;
          }) => {
            const identity = {
              baseUrl: server.baseUrl,
              apiKey: server.apiKey,
              model: profile.modelName,
              protocol: observation.protocol,
            };
            const key = capabilityCacheKey(identity);
            const current = this.settings.modelCapabilityCache[key];
            const observedFormat = (
              observation.dialect === "inline-tags" ? "inline_tags" : observation.dialect
            ) as ReasoningResponseFormat;
            if (current?.reasoning.responseFormats.includes(observedFormat)) {
              return;
            }
            this.settings.modelCapabilityCache = recordObservedReasoningFormat(
              this.settings.modelCapabilityCache,
              identity,
              observation.dialect,
            );
            void this.saveSettings();
          },
        }
        : {}),
    });
  }

  private createResponsesRoundProvider(
    profile: ChatModelProfile,
    server: ServerProfile,
    effectiveProtocol: "chat-completions" | "responses",
    reasoning: { enabled: boolean; effort?: string; summary: "off" | "auto" },
  ): ModelRoundProvider | undefined {
    if (effectiveProtocol !== "responses") return undefined;
    const capabilities = profile.reasoningCapabilities;
    if (server.apiFormat !== "openai-compatible") {
      throw new IxplorerError({
        code: "UNSUPPORTED_CAPABILITY",
        message: "The Responses protocol requires an OpenAI-compatible server profile.",
      });
    }
    if (!capabilities) {
      throw new IxplorerError({
        code: "UNSUPPORTED_CAPABILITY",
        message: "Responses capability detection has not completed for this model profile.",
      });
    }
    if (!capabilities.responses) {
      throw new IxplorerError({
        code: "UNSUPPORTED_CAPABILITY",
        message:
          capabilities.failureReason ??
          "The capability probe reported that this model does not support Responses.",
      });
    }
    if (!isResponsesCapabilityCurrent(capabilities, server, profile.modelName)) {
      throw new IxplorerError({
        code: "UNSUPPORTED_CAPABILITY",
        message: "The Responses capability probe is stale for this model profile.",
      });
    }
    if (reasoning.enabled) {
      if (capabilities.continuation !== true) {
        throw new IxplorerError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "Reasoning continuation has not been verified for this model profile.",
        });
      }
      if (capabilities.requiresEffort && !reasoning.effort) {
        throw new IxplorerError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "This model requires an explicit reasoning effort.",
        });
      }
      if (reasoning.effort && !capabilities.efforts.includes(reasoning.effort)) {
        throw new IxplorerError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "The selected reasoning effort is not supported by this model profile.",
        });
      }
      if (reasoning.summary === "auto" && !capabilities.summary) {
        throw new IxplorerError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "Reasoning summaries are not supported by this model profile.",
        });
      }
    }
    const responses = new OpenAiResponsesClient({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      logger: this.logger,
      reasoningEfforts: capabilities.efforts,
      reasoningSummary: capabilities.summary,
    });
    return new FallbackModelRoundProvider(
      responses,
      new ChatCompletionsRoundAdapter(this.createChatModelClient(server)),
    );
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

  private async migrateRemoveSkillsFolder(): Promise<void> {
    const skillsFolder = ".ixplorer/skills";
    try {
      const exists = await this.app.vault.adapter.exists(skillsFolder);
      if (!exists) return;
      const files = await this.app.vault.adapter.list(skillsFolder);
      for (const filePath of [...files.files, ...files.folders]) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file) await this.app.vault.trash(file, false);
      }
      const folder = this.app.vault.getAbstractFileByPath(skillsFolder);
      if (folder) await this.app.vault.trash(folder, false);
    } catch (error) {
      this.logger.logError(error, { url: "vault:.ixplorer/skills", method: "migrate" });
    }
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
