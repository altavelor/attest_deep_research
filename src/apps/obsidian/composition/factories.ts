import { App } from "obsidian";

import { ChatModelClient } from "../../../adapters/model-provider/chat/ChatModelClient";
import { OpenAiResponsesClient } from "../../../adapters/model-provider/chat/responses/OpenAiResponsesClient";
import { resolveResponsesProviderPolicy } from "../../../adapters/model-provider/chat/responses/ResponsesProviderPolicy";
import { ChatCompletionsRoundAdapter } from "../../../adapters/model-provider/chat/rounds/ChatCompletionsRoundAdapter";
import { FallbackModelRoundProvider } from "../../../adapters/model-provider/chat/rounds/FallbackModelRoundProvider";
import { EmbeddingClient } from "../../../adapters/model-provider/embeddings/EmbeddingClient";
import { DocxExtractor } from "../../../adapters/extractors/DocxExtractor";
import { EpubExtractor } from "../../../adapters/extractors/EpubExtractor";
import { Fb2Extractor } from "../../../adapters/extractors/Fb2Extractor";
import { MarkdownExtractor } from "../../../adapters/extractors/MarkdownExtractor";
import { PdfExtractor } from "../../../adapters/extractors/PdfExtractor";
import { PdfTextCache } from "../../../adapters/extractors/PdfTextCache";
import { TextExtractor } from "../../../adapters/extractors/TextExtractor";
import { IndexingService, IndexingState } from "../../../adapters/indexing/IndexingService";
import { FileVectorIndexStore, IndexProfile } from "../../../adapters/indexing/store/FileVectorIndexStore";
import { FileVectorInventoryStore } from "../../../adapters/indexing/inventory/FileVectorInventoryStore";
import { FileVectorIndexReader } from "../../../adapters/indexing/store/FileVectorIndexReader";
import { ObsidianVaultFileProvider } from "../../../adapters/obsidian/ObsidianVaultFileProvider";
import { RetrievalService } from "../../../adapters/retrieval/RetrievalService";
import { QueryExpansionService } from "../../../adapters/retrieval/QueryExpansionService";
import { ContextAssembler } from "../../../application/use-cases/chat/ContextAssembler";
import { stableId } from "../../../adapters/extractors/common";
import { DEFAULT_GRAPH_CONTEXT_LIMITS } from "../../../core/research/GraphContext";
import { ObsidianContextFileProvider } from "../../../adapters/obsidian/ObsidianContextFileProvider";
import { ObsidianGraphContextProvider } from "../../../adapters/obsidian/ObsidianGraphContextProvider";
import { NoteToolService } from "../../../adapters/research-tools/note/NoteTools";
import { createResearchToolRegistry } from "../../../adapters/research-tools/createResearchToolRegistry";
import { runToolLoop } from "../../../adapters/research-tools/ToolLoopRunner";
import { ObsidianVaultWriter } from "../../../adapters/obsidian/ObsidianVaultWriter";
import { ResearchService } from "../../../application/use-cases/research/ResearchService";
import { PluginDebugLogger } from "../../../adapters/settings/debugLogger";
import { resolveToolCapabilities } from "../../../adapters/settings/toolCapabilities";
import { isResponsesCapabilityCurrent } from "../../../adapters/settings/responsesCapabilityProbe";
import {
  capabilityCacheKey,
  recordObservedReasoningFormat,
} from "../../../adapters/settings/modelCapabilityCache";
import type { ReasoningResponseFormat } from "../../../adapters/settings/modelCapabilityCache";
import {
  ChatModelProfile,
  EmbeddingModelProfile,
  IxplorerSettings,
  ServerProfile,
} from "../../../adapters/settings/types";
import {
  resolveEffectiveChatApiProtocol,
  resolveEffectiveReasoning,
  resolveEffectiveTools,
} from "../../../adapters/settings/profileQueries";
import { DuckDuckGoSearchProvider } from "../../../adapters/web/DuckDuckGoSearchProvider";
import { FetchUrlStatusChecker } from "../../../adapters/web/FetchUrlStatusChecker";
import { resolveIndexDescriptionForPrompt } from "../../../adapters/indexing/inventory/IndexDescription";
import type { ModelRoundProvider } from "../../../core/agent/protocol";
import { obsidianRequestFetch } from "../obsidianFetch";
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
    deepResearchLogger: ctx.logger,
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
        writer: chatProfile.noteMutationAccess ? new ObsidianVaultWriter(ctx.app) : undefined,
        noteMutationAccess: chatProfile.noteMutationAccess,
      })
      : undefined,
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

export function createSearchProvider(
  ctx: CompositionContext,
): DuckDuckGoSearchProvider | undefined {
  if (!ctx.getSettings().duckDuckGoEnabled) {
    return undefined;
  }

  return new DuckDuckGoSearchProvider({
    fetch: obsidianRequestFetch,
    logger: ctx.logger,
    defaultResultLimit: ctx.getSettings().duckDuckGoResultLimit,
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
