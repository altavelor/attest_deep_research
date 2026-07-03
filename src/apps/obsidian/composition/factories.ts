import { App } from "obsidian";

import { ChatModelClient } from "@adapters/model-provider";
import { OpenAiResponsesClient } from "@adapters/model-provider";
import { resolveResponsesProviderPolicy } from "@adapters/model-provider";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import { FallbackModelRoundProvider } from "@adapters/model-provider";
import { EmbeddingClient } from "@adapters/model-provider";
import { DocxExtractor } from "@adapters/extractors";
import { EpubExtractor } from "@adapters/extractors";
import { Fb2Extractor } from "@adapters/extractors";
import { MarkdownExtractor } from "@adapters/extractors";
import { PdfExtractor } from "@adapters/extractors";
import { PdfTextCache } from "@adapters/extractors";
import { TextExtractor } from "@adapters/extractors";
import { IndexingService, IndexingState } from "@adapters/indexing";
import { FileVectorIndexStore, IndexProfile } from "@adapters/indexing";
import { FileVectorInventoryStore } from "@adapters/indexing";
import { FileVectorIndexReader } from "@adapters/indexing";
import { FileDocumentMetadataStore, LlmDocumentMetadataExtractor } from "@adapters/indexing";
import { EnrichIndexSources } from "@application/use-cases/enrichment";
import { ObsidianVaultFileProvider } from "@adapters/obsidian/ObsidianVaultFileProvider";
import { RetrievalService } from "@adapters/retrieval";
import { QueryExpansionService } from "@adapters/retrieval";
import { ContextAssembler } from "@application/use-cases/chat";
import { stableId } from "@adapters/extractors";
import { DEFAULT_GRAPH_CONTEXT_LIMITS } from "@core/research";
import { ObsidianContextFileProvider } from "@adapters/obsidian/ObsidianContextFileProvider";
import { ObsidianGraphContextProvider } from "@adapters/obsidian/ObsidianGraphContextProvider";
import { createResearchToolRegistry, NoteToolService, runToolLoop } from "@adapters/research-tools";
import { ObsidianVaultWriter } from "@adapters/obsidian/ObsidianVaultWriter";
import { ResearchService } from "@application/use-cases/research";
import { PluginDebugLogger } from "@adapters/settings";
import { resolveToolCapabilities } from "@adapters/settings";
import { isResponsesCapabilityCurrent } from "@adapters/settings";
import {
  capabilityCacheKey,
  recordObservedReasoningFormat,
} from "@adapters/settings";
import type { ReasoningResponseFormat } from "@adapters/settings";
import {
  ChatModelProfile,
  EmbeddingModelProfile,
  IxplorerSettings,
  ServerProfile,
} from "@adapters/settings";
import {
  resolveEffectiveChatApiProtocol,
  resolveEffectiveReasoning,
  resolveEffectiveTools,
} from "@adapters/settings";
import {
  createFetchFallbackProviders,
  createWebSearchSources,
  DuckDuckGoSearchProvider,
} from "@adapters/web";
import { FetchUrlStatusChecker } from "@adapters/web";
import type { SearchProvider, WebSearchSource } from "@application/ports";
import { FetchFallbackChain, WebQueryPlanner, WebSourceHealthTracker } from "@application/web";
import { DUCKDUCKGO_DESCRIPTOR } from "@core/web";
import { resolveIndexDescriptionForPrompt } from "@adapters/indexing";
import type { ModelRoundProvider } from "@core/agent";
import { obsidianRequestFetch } from "@apps/obsidian/obsidianFetch";
import {
  requireChatModelProfile,
  requireEmbeddingModelProfile,
  requireServerProfile,
  resolveIndexProfileForUse,
  requireIndexProfile,
} from "./profileResolvers";

/**
 * Collaborators the composition factories need from the plugin host. Keeping
 * them behind this interface lets the factories build the DI graph without
 * reaching back into the Obsidian `Plugin` instance directly.
 */
export interface CompositionContext {
  app: App;
  logger: PluginDebugLogger;
  pdfTextCache: PdfTextCache;
  /** Plugin-lifetime health state of web sources; planners are per-run, this is not. */
  webSourceHealth: WebSourceHealthTracker;
  getSettings(): IxplorerSettings;
  saveSettings(): Promise<void>;
  getVaultLocalPath(path: string): string;
  getIndexingState(profileId: string): IndexingState;
}

export function createResearchService(
  ctx: CompositionContext,
  chatModelProfileId?: string,
  indexProfileId?: string,
): ResearchService {
  const settings = ctx.getSettings();
  const indexProfile = resolveIndexProfileForUse(settings, indexProfileId);
  const chatProfile = requireChatModelProfile(settings, chatModelProfileId);
  const chatServer = requireServerProfile(settings, chatProfile.serverProfileId);
  const retriever = createRetrieverForProfile(ctx, indexProfile);
  const contextFiles = new ObsidianContextFileProvider(ctx.app.vault);
  const contextExtractors = createContextExtractorsForProfile(ctx, indexProfile);
  const toolResolution = resolveToolCapabilities(chatProfile.capabilities?.toolCalling);
  const toolsEnabled = resolveEffectiveTools(chatProfile);
  // A single vault writer backs both note mutations and document downloads; both
  // are gated by the profile's mutation consent.
  const vaultWriter = chatProfile.noteMutationAccess ? new ObsidianVaultWriter(ctx.app) : undefined;
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
  const modelRound = createResponsesRoundProvider(
    ctx,
    chatProfile,
    chatServer,
    effectiveProtocol,
    reasoning,
  );
  const capabilitySnapshot =
    settings.modelCapabilityCache[
    capabilityCacheKey({
      baseUrl: chatServer.baseUrl,
      apiKey: chatServer.apiKey,
      model: chatProfile.modelName,
      protocol: effectiveProtocol,
    })
    ];

  return new ResearchService({
    retriever,
    toolsetFactory: createResearchToolRegistry,
    modelRoundFactory: (model) => new ChatCompletionsRoundAdapter(model),
    runToolLoop,
    chatModel: createChatModelClient(ctx, chatServer, chatProfile),
    ...(modelRound ? { modelRound } : {}),
    reasoning,
    subAgentLogger: ctx.logger,
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
    queryExpansion: createQueryExpansionService(ctx, chatProfile, chatServer),
    contextAssembler: new ContextAssembler({
      files: contextFiles,
      extractors: contextExtractors,
      graph: new ObsidianGraphContextProvider(ctx.app.vault, ctx.app.metadataCache),
      retrieve: async () => [],
      generateId: stableId,
    }),
    graphContext: {
      enabled: settings.useLinkedNotes,
      includeBacklinks: settings.includeBacklinks,
      expandFilteredContextThroughLinks: settings.expandFilteredContextThroughLinks,
      depth: settings.graphContextDepth === 2 ? 2 : 1,
      limits: DEFAULT_GRAPH_CONTEXT_LIMITS,
    },
    evidencePlanner: {
      useWebWhenFreshnessNeeded: settings.useWebWhenFreshnessNeeded,
    },
    searchProvider: createSearchProvider(ctx),
    urlStatusChecker: new FetchUrlStatusChecker({ fetch: obsidianRequestFetch }),
    toolsEnabled,
    forceEagerResearch: settings.forceEagerResearch,
    toolCapabilities: toolResolution.capabilities,
    toolCapabilityProvenance: toolResolution.provenance,
    toolCapabilityProbeAudit: chatProfile.capabilities?.toolCalling?.probeAudit,
    apiFormat: chatServer.apiFormat,
    indexDescription: resolveIndexDescriptionForPrompt(indexProfile),
    getIndexStatus: () => {
      const state = ctx.getIndexingState(indexProfile.id);
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
        getActiveFilePath: () => ctx.app.workspace.getActiveFile()?.path,
        writer: vaultWriter,
        noteMutationAccess: chatProfile.noteMutationAccess,
      })
      : undefined,
    vaultWriter,
    downloadFolder: settings.downloadFolder,
  });
}

export function createIndexingService(
  ctx: CompositionContext,
  profileId: string,
  onProgress: (state: IndexingState) => void,
): IndexingService {
  const settings = ctx.getSettings();
  const indexProfile = requireIndexProfile(settings, profileId);
  const embeddingProfile = requireEmbeddingModelProfile(settings, indexProfile.embeddingModelProfileId);

  return new IndexingService({
    files: new ObsidianVaultFileProvider(ctx.app.vault),
    extractors: createExtractorsForProfile(ctx, indexProfile),
    embeddings: createEmbeddingClientForProfile(ctx, embeddingProfile),
    indexStore: createVectorIndexStoreForProfile(ctx, indexProfile),
    embeddingModel: embeddingProfile.modelName,
    includeFolders: indexProfile.includeFolders,
    excludeGlobs: indexProfile.excludeGlobs,
    batchSize: indexProfile.embeddingBatchSize,
    onProgress,
    logger: ctx.logger,
  });
}

export function createEmbeddingClientForProfile(
  ctx: CompositionContext,
  embeddingProfile: EmbeddingModelProfile,
): EmbeddingClient {
  const server = requireServerProfile(ctx.getSettings(), embeddingProfile.serverProfileId);
  return new EmbeddingClient({
    apiFormat: server.apiFormat,
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    logger: ctx.logger,
  });
}

export function createVectorIndexStoreForProfile(
  ctx: CompositionContext,
  indexProfile: IndexProfile,
): FileVectorIndexStore {
  return new FileVectorIndexStore({
    folder: ctx.getVaultLocalPath(indexProfile.indexFolder),
    profileId: indexProfile.id,
    shardCount: indexProfile.shardCount,
    onPerformance: (event) => ctx.logger.logIndexingPerformance(event),
  });
}

export function createRetrieverForProfile(
  ctx: CompositionContext,
  indexProfile: IndexProfile,
): RetrievalService {
  const embeddingProfile = requireEmbeddingModelProfile(
    ctx.getSettings(),
    indexProfile.embeddingModelProfileId,
  );
  const indexStore = createVectorIndexStoreForProfile(ctx, indexProfile);
  const reader = new FileVectorIndexReader(indexStore, indexStore);
  return new RetrievalService({
    embeddings: createEmbeddingClientForProfile(ctx, embeddingProfile),
    indexStore,
    embeddingModel: embeddingProfile.modelName,
    keyword: reader,
    chunkInventory: reader,
    languageInventory: reader,
    inventory: new FileVectorInventoryStore(indexStore),
    documentMetadata: createDocumentMetadataStoreForProfile(ctx, indexProfile),
  });
}

export function createDocumentMetadataStoreForProfile(
  ctx: CompositionContext,
  indexProfile: IndexProfile,
): FileDocumentMetadataStore {
  return new FileDocumentMetadataStore(ctx.getVaultLocalPath(indexProfile.indexFolder));
}

/**
 * Index enrichment (SPEC-corpus-knowledge R3): extracts bibliographic metadata
 * for every indexed source with the active chat model. Triggered explicitly
 * (command) — never as a silent side effect of indexing, because it spends
 * LLM tokens proportional to corpus size.
 */
export function createEnrichmentService(
  ctx: CompositionContext,
  indexProfileId: string,
  chatModelProfileId?: string,
): EnrichIndexSources {
  const settings = ctx.getSettings();
  const indexProfile = requireIndexProfile(settings, indexProfileId);
  const chatProfile = requireChatModelProfile(settings, chatModelProfileId);
  const server = requireServerProfile(settings, chatProfile.serverProfileId);

  return new EnrichIndexSources({
    retriever: createRetrieverForProfile(ctx, indexProfile),
    metadataStore: createDocumentMetadataStoreForProfile(ctx, indexProfile),
    extractor: new LlmDocumentMetadataExtractor({
      provider: createChatModelClient(ctx, server, chatProfile),
      model: chatProfile.modelName,
    }),
  });
}

export function createChatModelClient(
  ctx: CompositionContext,
  server: ServerProfile,
  profile?: ChatModelProfile,
): ChatModelClient {
  return new ChatModelClient({
    apiFormat: server.apiFormat,
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    logger: ctx.logger,
    ...(profile
      ? {
        onReasoningObserved: (observation: { protocol: "chat-completions"; dialect: string }) => {
          const identity = {
            baseUrl: server.baseUrl,
            apiKey: server.apiKey,
            model: profile.modelName,
            protocol: observation.protocol,
          };
          const key = capabilityCacheKey(identity);
          const settings = ctx.getSettings();
          const current = settings.modelCapabilityCache[key];
          const observedFormat = (
            observation.dialect === "inline-tags" ? "inline_tags" : observation.dialect
          ) as ReasoningResponseFormat;
          if (current?.reasoning.responseFormats.includes(observedFormat)) {
            return;
          }
          settings.modelCapabilityCache = recordObservedReasoningFormat(
            settings.modelCapabilityCache,
            identity,
            observation.dialect,
          );
          void ctx.saveSettings();
        },
      }
      : {}),
  });
}

export function createResponsesRoundProvider(
  ctx: CompositionContext,
  profile: ChatModelProfile,
  server: ServerProfile,
  effectiveProtocol: "chat-completions" | "responses",
  reasoning: { enabled: boolean; effort?: string; summary: "off" | "auto" },
): ModelRoundProvider | undefined {
  if (effectiveProtocol !== "responses") return undefined;
  const decision = resolveResponsesProviderPolicy({
    apiFormat: server.apiFormat,
    capabilities: profile.reasoningCapabilities,
    isCapabilityCurrent: profile.reasoningCapabilities
      ? isResponsesCapabilityCurrent(profile.reasoningCapabilities, server, profile.modelName)
      : false,
    reasoning,
  });
  const responses = new OpenAiResponsesClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    logger: ctx.logger,
    reasoningEfforts: decision.efforts,
    reasoningSummary: decision.summary,
  });
  return new FallbackModelRoundProvider(
    responses,
    new ChatCompletionsRoundAdapter(createChatModelClient(ctx, server)),
  );
}

export function createQueryExpansionService(
  ctx: CompositionContext,
  chatProfile: ChatModelProfile,
  server: ServerProfile,
): QueryExpansionService {
  return new QueryExpansionService({
    chatModel: createChatModelClient(ctx, server),
    chatModelName: chatProfile.modelName,
    chatOptions: {
      temperature: chatProfile.temperature,
      maxTokens: chatProfile.maxTokens,
    },
  });
}

/**
 * Web search entry point for research tools. The query planner routes across
 * the enabled hub sources (DuckDuckGo is one of them, from the catalog row).
 * Page fetches run through the fallback chain: native → Jina → Zyte → Wayback.
 */
export function createSearchProvider(ctx: CompositionContext): SearchProvider | undefined {
  const settings = ctx.getSettings();
  const runtime = {
    fetch: obsidianRequestFetch,
    logger: ctx.logger,
  };

  // Always constructed: its fetch core serves page fetches even when the
  // DuckDuckGo search row is disabled.
  const duckDuckGoProfile = settings.webSources.find(
    (profile) => profile.sourceId === DUCKDUCKGO_DESCRIPTOR.id,
  );
  const duckDuckGo = new DuckDuckGoSearchProvider(runtime);
  const duckDuckGoEnabled = duckDuckGoProfile?.enabled === true;
  const hubSources = createWebSearchSources(settings.webSources, runtime);
  const pool: WebSearchSource[] = [
    ...(duckDuckGoEnabled
      ? [Object.assign(duckDuckGo, { descriptor: DUCKDUCKGO_DESCRIPTOR })]
      : []),
    ...hubSources,
  ];
  if (pool.length === 0) {
    return undefined;
  }

  const fetchDelegate = new FetchFallbackChain({
    primary: duckDuckGo,
    fallbacks: createFetchFallbackProviders(settings.webSources, duckDuckGo, {
      fetch: obsidianRequestFetch,
      logger: ctx.logger,
    }),
    onFallback: (providerId, failure) =>
      ctx.logger?.logError(failure.ok ? undefined : failure.error, {
        url: `fetch-fallback:${providerId}`,
      }),
  });

  return new WebQueryPlanner({
    registry: { enabledSources: () => pool },
    fetchDelegate,
    health: ctx.webSourceHealth,
    onSourceError: (sourceId, error) => ctx.logger?.logError(error, { url: `source:${sourceId}` }),
  });
}

export function createExtractorsForProfile(ctx: CompositionContext, indexProfile: IndexProfile) {
  // Indexing scopes markdown extraction to the configured folders/globs.
  return buildExtractors(ctx, indexProfile, { scopedMarkdown: true });
}

export function createContextExtractorsForProfile(
  ctx: CompositionContext,
  indexProfile: IndexProfile,
) {
  // Context assembly reads explicitly requested files, so markdown is unscoped.
  return buildExtractors(ctx, indexProfile, { scopedMarkdown: false });
}

function buildExtractors(
  ctx: CompositionContext,
  indexProfile: IndexProfile,
  options: { scopedMarkdown: boolean },
) {
  const chunk = {
    maxChunkLength: indexProfile.chunkSize,
    chunkOverlap: indexProfile.chunkOverlap,
  };
  return [
    new MarkdownExtractor({
      ...(options.scopedMarkdown
        ? { includeFolders: indexProfile.includeFolders, excludeGlobs: indexProfile.excludeGlobs }
        : {}),
      ...chunk,
    }),
    new TextExtractor({ ...chunk }),
    new PdfExtractor({
      maxChunkLength: indexProfile.pdfChunkSize,
      chunkOverlap: indexProfile.pdfChunkOverlap,
      cache: ctx.pdfTextCache,
    }),
    new EpubExtractor({ ...chunk }),
    new Fb2Extractor({ ...chunk }),
    new DocxExtractor({ ...chunk }),
  ];
}
