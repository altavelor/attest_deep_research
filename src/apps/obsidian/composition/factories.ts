import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import {
  LlmClaimExtractor,
  LlmDocumentMetadataExtractor,
  LlmDocumentSummarizer,
} from "@adapters/indexing";
import { EnrichIndexSources } from "@application/use-cases/enrichment";
import { ContextAssembler } from "@application/use-cases/chat";
import { stableId } from "@adapters/extractors";
import { DEFAULT_GRAPH_CONTEXT_LIMITS } from "@core/research";
import { ObsidianGraphContextProvider } from "@adapters/obsidian/ObsidianGraphContextProvider";
import { createResearchToolRegistry, NoteToolService, runToolLoop } from "@adapters/research-tools";
import { ObsidianVaultWriter } from "@adapters/obsidian/ObsidianVaultWriter";
import { ResearchService } from "@application/use-cases/research";
import type { ResearchSearchMode } from "@application/use-cases/research";
import { getActiveIndexProfile, resolveToolCapabilities } from "@adapters/settings";
import { isResponsesCapabilityCurrent } from "@adapters/settings";
import { capabilityCacheKey } from "@adapters/settings";
import {
  resolveEffectiveChatApiProtocol,
  resolveEffectiveReasoning,
  resolveEffectiveTools,
} from "@adapters/settings";
import { FetchUrlStatusChecker } from "@adapters/web";
import { resolveIndexDescriptionForPrompt } from "@adapters/indexing";
import { obsidianRequestFetch } from "@apps/obsidian/obsidianFetch";
import {
  requireChatModelProfile,
  requireServerProfile,
  resolveIndexProfileForUse,
  requireIndexProfile,
} from "./profileResolvers";
import { createWebSearchProvider } from "./webSearchFactory";
import { createDocumentImageCandidates, createImageSearchRegistry } from "./mediaFactory";
import type { WebQueryIntentClassifier } from "@application/web";
import { ModelWebQueryIntentClassifier } from "@application/web";
import {
  createChatModelClient,
  createQueryExpansionService,
  createResponsesRoundProvider,
} from "./modelClientFactory";
import {
  createContextExtractorsForProfile,
  createDocumentClaimStoreForProfile,
  createDocumentMetadataStoreForProfile,
  createDocumentSummaryStoreForProfile,
  createRetrieverForProfile,
  createVectorIndexStoreForProfile,
} from "./indexingFactory";

export type { CompositionContext } from "./CompositionContext";
export {
  createChatModelClient,
  createQueryExpansionService,
  createResponsesRoundProvider,
} from "./modelClientFactory";
export {
  createContextExtractorsForProfile,
  createDocumentClaimStoreForProfile,
  createDocumentMetadataStoreForProfile,
  createDocumentSummaryStoreForProfile,
  createEmbeddingClientForProfile,
  createExtractorsForProfile,
  createIndexingService,
  createRetrieverForProfile,
  createVectorIndexStoreForProfile,
} from "./indexingFactory";
import type { CompositionContext } from "./CompositionContext";

function usesIndex(searchMode: ResearchSearchMode | undefined): boolean {
  return searchMode !== "webOnly" && searchMode !== "none";
}

/**
 * Builds the research turn for one chat model profile. A turn that never reads
 * the index — web-only or explicit sources only — is composed without one, so a
 * vault with no built index still answers instead of failing to start.
 */
export function createResearchService(
  ctx: CompositionContext,
  chatModelProfileId?: string,
  indexProfileId?: string,
  searchMode?: ResearchSearchMode,
): ResearchService {
  const settings = ctx.getSettings();
  const indexProfile = usesIndex(searchMode)
    ? resolveIndexProfileForUse(settings, ctx.translator.t, indexProfileId)
    : undefined;
  const chatProfile = requireChatModelProfile(settings, ctx.translator.t, chatModelProfileId);
  const chatServer = requireServerProfile(settings, ctx.translator.t, chatProfile.serverProfileId);
  const reportedProfile = indexProfile ?? getActiveIndexProfile(settings);
  const retriever = indexProfile ? createRetrieverForProfile(ctx, indexProfile) : undefined;
  const contextFiles = ctx.warmCaches.contextFiles();
  const contextExtractors = createContextExtractorsForProfile(ctx, reportedProfile);
  const toolResolution = resolveToolCapabilities(chatProfile.capabilities?.toolCalling);
  const toolsEnabled = resolveEffectiveTools(chatProfile);
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
    ...(settings.expandSearchQuery && retriever
      ? { queryExpansion: createQueryExpansionService(ctx, chatProfile, chatServer) }
      : {}),
    contextAssembler: new ContextAssembler({
      files: contextFiles,
      extractors: contextExtractors,
      graph: new ObsidianGraphContextProvider(ctx.app.vault, ctx.app.metadataCache),
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
    searchProvider: createSearchProvider(
      ctx,
      new ModelWebQueryIntentClassifier({
        chatModel: createChatModelClient(ctx, chatServer, chatProfile),
        model: chatProfile.modelName,
      }),
    ),
    ...(createImageSearchRegistry(ctx) ? { imageSearch: createImageSearchRegistry(ctx)! } : {}),
    ...(indexProfile
      ? {
          documentImageCandidates: createDocumentImageCandidates(
            ctx,
            createVectorIndexStoreForProfile(ctx, indexProfile),
          ),
          indexDescription: resolveIndexDescriptionForPrompt(indexProfile),
        }
      : {}),
    getIndexStatus: () => {
      const state = ctx.getIndexingState(reportedProfile.id);
      return {
        status: state.status,
        available: Boolean(reportedProfile.lastIndexedAt || state.indexedFiles > 0),
        isStale: state.isStale,
        indexedFiles: state.indexedFiles,
        ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
      };
    },
    urlStatusChecker: new FetchUrlStatusChecker({ fetch: obsidianRequestFetch }),
    toolsEnabled,
    toolCapabilities: toolResolution.capabilities,
    toolCapabilityProvenance: toolResolution.provenance,
    toolCapabilityProbeAudit: chatProfile.capabilities?.toolCalling?.probeAudit,
    apiFormat: chatServer.apiFormat,
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
  const indexProfile = requireIndexProfile(settings, ctx.translator.t, indexProfileId);
  const chatProfile = requireChatModelProfile(settings, ctx.translator.t, chatModelProfileId);
  const server = requireServerProfile(settings, ctx.translator.t, chatProfile.serverProfileId);

  const provider = createChatModelClient(ctx, server, chatProfile);
  return new EnrichIndexSources({
    retriever: createRetrieverForProfile(ctx, indexProfile),
    metadataStore: createDocumentMetadataStoreForProfile(ctx, indexProfile),
    extractor: new LlmDocumentMetadataExtractor({
      provider,
      model: chatProfile.modelName,
    }),
    summaryStore: createDocumentSummaryStoreForProfile(ctx, indexProfile),
    summarizer: new LlmDocumentSummarizer({
      provider,
      model: chatProfile.modelName,
    }),
    claimStore: createDocumentClaimStoreForProfile(ctx, indexProfile),
    claimExtractor: new LlmClaimExtractor({
      provider,
      model: chatProfile.modelName,
    }),
  });
}

export function createSearchProvider(
  ctx: CompositionContext,
  intentClassifier?: WebQueryIntentClassifier,
) {
  return createWebSearchProvider({
    settings: ctx.getSettings(),
    logger: ctx.logger,
    health: ctx.webSourceHealth,
    ...(intentClassifier ? { intentClassifier } : {}),
  });
}
