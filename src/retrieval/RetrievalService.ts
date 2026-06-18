import {
  Citation,
  AdjacentChunkIndexStore,
  EmbeddingProviderClient,
  IndexStore,
  LanguageInventoryIndexStore,
  LanguageInventoryItem,
  KeywordSearchIndexStore,
  RetrievedChunk,
  RetrievalQueryVariant,
  RetrievalOptions,
  SourceReference,
} from "../shared/types";
import { formatCitation } from "./citations";
import { rankKeywordMatches } from "./ranking";
import { filterRetrievedChunks } from "./retrievalFilters";

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  usedFallback: boolean;
  queryVariants?: RetrievalQueryVariant[];
}

export interface RetrievalServiceOptions {
  embeddings: EmbeddingProviderClient;
  indexStore: IndexStore;
  embeddingModel: string;
  keywordCorpus: RetrievedChunk[];
}

export class RetrievalService {
  private readonly embeddings: EmbeddingProviderClient;
  private readonly indexStore: IndexStore;
  private readonly embeddingModel: string;
  private readonly keywordCorpus: RetrievedChunk[];

  constructor(options: RetrievalServiceOptions) {
    this.embeddings = options.embeddings;
    this.indexStore = options.indexStore;
    this.embeddingModel = options.embeddingModel;
    this.keywordCorpus = options.keywordCorpus;
  }

  async search(query: string, options: RetrievalOptions): Promise<RetrievalResult> {
    const candidateLimit = Math.max(options.limit, options.limit * 4);
    const queryVariants = normalizedQueryVariants(query, options.queryVariants);
    const semanticChunksByVariant: RetrievedChunk[] = [];
    const keywordChunksByVariant: RetrievedChunk[] = [];

    for (const variant of queryVariants) {
      semanticChunksByVariant.push(
        ...filterRetrievedChunks(await this.searchSemantic(variant, candidateLimit), options),
      );
      keywordChunksByVariant.push(
        ...(await this.searchKeywords(variant, { ...options, limit: candidateLimit })),
      );
    }

    const semanticChunks = fuseRetrievedChunks(semanticChunksByVariant, [], candidateLimit);
    const keywordChunks = fuseRetrievedChunks(keywordChunksByVariant, [], candidateLimit);
    const fusedChunks = fuseRetrievedChunks(semanticChunks, keywordChunks, candidateLimit);
    const chunks = await this.expandAdjacentChunks(
      fusedChunks.slice(0, options.limit),
      1,
      options.limit,
    );

    return {
      chunks,
      citations: chunks.map((chunk) => ({
        ...formatCitation(chunk.source),
        id: chunk.id,
      })),
      usedFallback: semanticChunks.length === 0 && keywordChunks.length > 0,
    };
  }

  async getLanguageInventory(): Promise<LanguageInventoryItem[]> {
    if (!isLanguageInventoryIndexStore(this.indexStore)) {
      return [];
    }

    return this.indexStore.getLanguageInventory();
  }

  async expandAdjacentEvidence(
    chunks: RetrievedChunk[],
    radius: number,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    return this.expandAdjacentChunks(chunks, radius, limit);
  }

  async getAdjacentChunks(
    source: SourceReference,
    chunkId: string,
    radius: number,
  ): Promise<RetrievedChunk[]> {
    if (!isDirectAdjacentChunkIndexStore(this.indexStore)) {
      return [];
    }

    return this.indexStore.getAdjacentChunks(source, chunkId, radius);
  }

  private async searchSemantic(query: string, limit: number): Promise<RetrievedChunk[]> {
    try {
      const response = await this.embeddings.embed({
        model: this.embeddingModel,
        input: [query],
      });
      const embedding = response.embeddings[0];

      if (!embedding) {
        return [];
      }

      await this.indexStore.initialize({
        embeddingModel: this.embeddingModel,
        embeddingDimensions: embedding.length,
      });

      return this.indexStore.query(embedding, limit);
    } catch {
      return [];
    }
  }

  private keywordCorpusForOptions(options: RetrievalOptions): RetrievedChunk[] {
    return filterRetrievedChunks(this.keywordCorpus, options);
  }

  private async searchKeywords(
    query: string,
    options: RetrievalOptions,
  ): Promise<RetrievedChunk[]> {
    if (isKeywordSearchIndexStore(this.indexStore)) {
      const chunks = await this.indexStore.searchKeywords(query, options);

      if (chunks.length > 0) {
        return chunks;
      }
    }

    return rankKeywordMatches(query, this.keywordCorpusForOptions(options), options.limit);
  }

  private async expandAdjacentChunks(
    chunks: RetrievedChunk[],
    radius: number,
    limit: number,
  ): Promise<RetrievedChunk[]> {
    if (!isAdjacentChunkIndexStore(this.indexStore)) {
      return chunks.slice(0, limit);
    }

    return this.indexStore.expandAdjacentChunks(chunks, radius, limit);
  }
}

function normalizedQueryVariants(
  query: string,
  variants: RetrievalOptions["queryVariants"],
): string[] {
  const normalized = [query, ...(variants?.map((variant) => variant.query) ?? [])]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return Array.from(new Set(normalized)).slice(0, 8);
}

function isKeywordSearchIndexStore(
  indexStore: IndexStore,
): indexStore is IndexStore & KeywordSearchIndexStore {
  return "searchKeywords" in indexStore && typeof indexStore.searchKeywords === "function";
}

function isAdjacentChunkIndexStore(
  indexStore: IndexStore,
): indexStore is IndexStore & AdjacentChunkIndexStore {
  return (
    "expandAdjacentChunks" in indexStore && typeof indexStore.expandAdjacentChunks === "function"
  );
}

function isDirectAdjacentChunkIndexStore(
  indexStore: IndexStore,
): indexStore is IndexStore & AdjacentChunkIndexStore {
  return "getAdjacentChunks" in indexStore && typeof indexStore.getAdjacentChunks === "function";
}

function isLanguageInventoryIndexStore(
  indexStore: IndexStore,
): indexStore is IndexStore & LanguageInventoryIndexStore {
  return (
    "getLanguageInventory" in indexStore && typeof indexStore.getLanguageInventory === "function"
  );
}

function fuseRetrievedChunks(
  semanticChunks: RetrievedChunk[],
  keywordChunks: RetrievedChunk[],
  limit: number,
): RetrievedChunk[] {
  const scores = new Map<string, { chunk: RetrievedChunk; score: number }>();

  addRanked(scores, semanticChunks, 1.0);
  addRanked(scores, keywordChunks, 0.8);

  return Array.from(scores.values())
    .sort((left, right) => right.score - left.score || right.chunk.score - left.chunk.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({ ...chunk, score }));
}

function addRanked(
  scores: Map<string, { chunk: RetrievedChunk; score: number }>,
  chunks: RetrievedChunk[],
  weight: number,
): void {
  const rankConstant = 60;

  chunks.forEach((chunk, index) => {
    const existing = scores.get(chunk.id);
    const score = weight / (rankConstant + index + 1);

    scores.set(chunk.id, {
      chunk: existing?.chunk ?? chunk,
      score: (existing?.score ?? 0) + score,
    });
  });
}
