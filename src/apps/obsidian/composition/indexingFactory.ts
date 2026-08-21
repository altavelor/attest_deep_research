import {
  DocxExtractor,
  EpubExtractor,
  Fb2Extractor,
  MarkdownExtractor,
  PdfExtractor,
  TextExtractor,
} from "@adapters/extractors";
import {
  FileDocumentClaimStore,
  FileDocumentMetadataStore,
  FileDocumentSummaryStore,
  FileVectorIndexReader,
  FileVectorIndexStore,
  FileVectorInventoryStore,
  IndexingService,
  IndexProfile,
} from "@adapters/indexing";
import type { IndexingState } from "@adapters/indexing";
import { EmbeddingClient } from "@adapters/model-provider";
import { ObsidianVaultFileProvider } from "@adapters/obsidian/ObsidianVaultFileProvider";
import { RetrievalService } from "@adapters/retrieval";
import { EmbeddingModelProfile } from "@adapters/settings";
import { resolveProviderFetch } from "@apps/obsidian/modelProviderRuntime";

import { CompositionContext } from "./CompositionContext";
import { createLinkedImagePathResolver } from "./mediaFactory";
import {
  effectiveEmbeddingBatchSize,
  mobileIndexingOptions,
  mobileFileSizeLimits,
  pdfPageConcurrency,
} from "./mobileIndexingPolicy";
import {
  requireEmbeddingModelProfile,
  requireIndexProfile,
  requireServerProfile,
} from "./profileResolvers";

export function createIndexingService(
  ctx: CompositionContext,
  profileId: string,
  onProgress: (state: IndexingState) => void,
): IndexingService {
  const settings = ctx.getSettings();
  const indexProfile = requireIndexProfile(settings, ctx.translator.t, profileId);
  const embeddingProfile = requireEmbeddingModelProfile(
    settings,
    ctx.translator.t,
    indexProfile.embeddingModelProfileId,
  );
  return new IndexingService({
    files: new ObsidianVaultFileProvider(ctx.app.vault),
    extractors: createExtractorsForProfile(ctx, indexProfile),
    embeddings: createEmbeddingClientForProfile(ctx, embeddingProfile),
    indexStore: createVectorIndexStoreForProfile(ctx, indexProfile),
    embeddingModel: embeddingProfile.modelName,
    includeFolders: indexProfile.includeFolders,
    excludeGlobs: indexProfile.excludeGlobs,
    batchSize: effectiveEmbeddingBatchSize(indexProfile.embeddingBatchSize, ctx.isMobile === true),
    ...mobileIndexingOptions(ctx.isMobile === true),
    ...(mobileFileSizeLimits(ctx.isMobile === true)
      ? { maxFileSizeBytesByExtension: mobileFileSizeLimits(true) }
      : {}),
    onProgress,
    logger: ctx.logger,
    resolveLinkedImagePath: createLinkedImagePathResolver(ctx),
  });
}

export function createEmbeddingClientForProfile(
  ctx: CompositionContext,
  profile: EmbeddingModelProfile,
): EmbeddingClient {
  const server = requireServerProfile(ctx.getSettings(), ctx.translator.t, profile.serverProfileId);
  return new EmbeddingClient({
    apiFormat: server.apiFormat,
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    fetch: resolveProviderFetch(server, "buffered", ctx.isMobile === true),
    logger: ctx.logger,
  });
}

export function createVectorIndexStoreForProfile(
  ctx: CompositionContext,
  profile: IndexProfile,
): FileVectorIndexStore {
  return new FileVectorIndexStore({
    fileSystem: ctx.fileSystem,
    folder: profile.indexFolder,
    profileId: profile.id,
    shardCount: profile.shardCount,
    onPerformance: (event) => ctx.logger.logIndexingPerformance(event),
  });
}

export function createRetrieverForProfile(
  ctx: CompositionContext,
  profile: IndexProfile,
): RetrievalService {
  const embedding = requireEmbeddingModelProfile(
    ctx.getSettings(),
    ctx.translator.t,
    profile.embeddingModelProfileId,
  );
  const indexStore = createVectorIndexStoreForProfile(ctx, profile);
  const reader = new FileVectorIndexReader(indexStore, indexStore);
  return new RetrievalService({
    embeddings: createEmbeddingClientForProfile(ctx, embedding),
    indexStore,
    embeddingModel: embedding.modelName,
    keyword: reader,
    chunkInventory: reader,
    languageInventory: ctx.warmCaches.languageInventory(profile.id, reader),
    inventory: new FileVectorInventoryStore(indexStore),
    documentMetadata: createDocumentMetadataStoreForProfile(ctx, profile),
    documentSummaries: createDocumentSummaryStoreForProfile(ctx, profile),
    documentClaims: createDocumentClaimStoreForProfile(ctx, profile),
  });
}

export function createDocumentMetadataStoreForProfile(
  ctx: CompositionContext,
  profile: IndexProfile,
): FileDocumentMetadataStore {
  return new FileDocumentMetadataStore(ctx.fileSystem, profile.indexFolder);
}
export function createDocumentSummaryStoreForProfile(
  ctx: CompositionContext,
  profile: IndexProfile,
): FileDocumentSummaryStore {
  return new FileDocumentSummaryStore(ctx.fileSystem, profile.indexFolder);
}
export function createDocumentClaimStoreForProfile(
  ctx: CompositionContext,
  profile: IndexProfile,
): FileDocumentClaimStore {
  return new FileDocumentClaimStore(ctx.fileSystem, profile.indexFolder);
}
export function createExtractorsForProfile(ctx: CompositionContext, profile: IndexProfile) {
  return buildExtractors(ctx, profile, true);
}
export function createContextExtractorsForProfile(ctx: CompositionContext, profile: IndexProfile) {
  return buildExtractors(ctx, profile, false);
}

function buildExtractors(ctx: CompositionContext, profile: IndexProfile, scopedMarkdown: boolean) {
  const chunk = { maxChunkLength: profile.chunkSize, chunkOverlap: profile.chunkOverlap };
  return [
    new MarkdownExtractor({
      ...(scopedMarkdown
        ? { includeFolders: profile.includeFolders, excludeGlobs: profile.excludeGlobs }
        : {}),
      ...chunk,
    }),
    new TextExtractor({ ...chunk }),
    new PdfExtractor({
      maxChunkLength: profile.pdfChunkSize,
      chunkOverlap: profile.pdfChunkOverlap,
      cache: ctx.pdfTextCache,
      pageConcurrency: pdfPageConcurrency(ctx.isMobile === true),
    }),
    new EpubExtractor({ ...chunk }),
    new Fb2Extractor({ ...chunk }),
    new DocxExtractor({ ...chunk }),
  ];
}
