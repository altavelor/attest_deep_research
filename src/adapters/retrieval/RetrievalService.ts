import {
  IndexChunkInventoryStore,
  IndexStore,
  LanguageInventoryIndexStore,
} from "@application/ports";
import {
  ClaimGroup,
  DocumentClaimStore,
  DocumentMetadataStore,
  DocumentSummaryStore,
  FindClaimsOptions,
  SharedReference,
  FindInIndexOptions,
  IndexChunkListOptions,
  IndexChunkReadOptions,
  IndexInventoryStore,
  IndexMetadataSearchOptions,
  IndexSectionReadOptions,
  IndexSourceInventoryOptions,
  KeywordSearchIndexStore,
} from "@application/ports";
import { sharedReferences } from "@application/use-cases/enrichment";
import { groupClaims } from "@application/use-cases/claims";
import { RetrievalOptions, RetrievalQueryVariant } from "@core/retrieval";
import { mapWithConcurrency } from "@shared";
import { EmbeddingProviderClient } from "@core/agent";
import { LanguageInventoryItem } from "@core/model";
import { RetrievedChunk, SourceReference } from "@core/model";
import { formatCitation } from "@core/retrieval";
import { dedupeNearDuplicateChunks, filterRetrievedChunks } from "@core/retrieval";
import { RetrievalResult } from "@application/contracts";
import {
  IndexedUrlInventoryOptions,
  IndexedUrlInventoryResult,
  IndexedUrlReference,
} from "@application/contracts";

export type { RetrievalResult };

export interface RetrievalServiceOptions {
  embeddings: EmbeddingProviderClient;
  indexStore: IndexStore;
  embeddingModel: string;

  keyword?: KeywordSearchIndexStore;
  chunkInventory?: IndexChunkInventoryStore;
  languageInventory?: LanguageInventoryIndexStore;
  inventory?: IndexInventoryStore;

  documentMetadata?: DocumentMetadataStore;
  documentSummaries?: DocumentSummaryStore;
  documentClaims?: DocumentClaimStore;
}

export class RetrievalService {
  private readonly embeddings: EmbeddingProviderClient;
  private readonly indexStore: IndexStore;
  private readonly embeddingModel: string;
  private readonly keyword?: KeywordSearchIndexStore;
  private readonly chunkInventory?: IndexChunkInventoryStore;
  private readonly languageInventory?: LanguageInventoryIndexStore;
  private readonly inventory?: IndexInventoryStore;
  private readonly documentMetadata?: DocumentMetadataStore;
  private readonly documentSummaries?: DocumentSummaryStore;
  private readonly documentClaims?: DocumentClaimStore;

  constructor(options: RetrievalServiceOptions) {
    this.embeddings = options.embeddings;
    this.indexStore = options.indexStore;
    this.embeddingModel = options.embeddingModel;
    this.keyword = options.keyword;
    this.chunkInventory = options.chunkInventory;
    this.languageInventory = options.languageInventory;
    this.inventory = options.inventory;
    this.documentMetadata = options.documentMetadata;
    this.documentSummaries = options.documentSummaries;
    this.documentClaims = options.documentClaims;
  }

  async search(query: string, options: RetrievalOptions): Promise<RetrievalResult> {
    const scoped = await this.resolveLanguageScope(withBoostedPathsInScope(options));
    if (options.language && this.inventory && (scoped.sourcePaths?.length ?? 0) === 0) {
      return { chunks: [], citations: [], usedFallback: false };
    }

    const candidateLimit = Math.max(options.limit, options.limit * candidateOverFetch(scoped));
    const originalQueries = normalizedQueries([query]);
    const originalPass = this.searchQueries(originalQueries, candidateLimit, scoped);
    const variantPass = resolveQueryVariants(options.queryVariants)
      .then((variants) =>
        this.searchQueries(
          options.signal?.aborted === true
            ? []
            : normalizedQueries(variants.map((variant) => variant.query))
                .filter((variant) => !originalQueries.includes(variant))
                .slice(0, MAX_FUSED_QUERIES - originalQueries.length),
          candidateLimit,
          scoped,
        ),
      )
      .catch((): QueryPassResult => ({ semanticChunks: [], keywordChunks: [] }));
    const [original, variant] = await Promise.all([originalPass, variantPass]);
    const semanticError = original.semanticError ?? variant.semanticError;

    const semanticChunks = fuseRetrievedChunks(
      [...original.semanticChunks, ...variant.semanticChunks],
      [],
      candidateLimit,
    );
    const keywordChunks = fuseRetrievedChunks(
      [...original.keywordChunks, ...variant.keywordChunks],
      [],
      candidateLimit,
    );
    const fused = boostChunksFromSources(
      fuseRetrievedChunks(semanticChunks, keywordChunks, candidateLimit),
      scoped.boostedSourcePaths,
    );
    const ranked = scoped.diversify ? oneChunkPerSource(fused) : fused;
    const deduped = dedupeNearDuplicateChunks(ranked);
    const chunks = deduped.slice(0, options.limit);

    return {
      chunks,
      citations: chunks.map((chunk) => ({
        ...formatCitation(chunk.source),
        id: chunk.id,
      })),
      usedFallback: semanticChunks.length === 0 && keywordChunks.length > 0,
      ...(semanticError ? { semanticError } : {}),
    };
  }

  /**
   * When a language is requested, resolve it to the set of sources indexed in
   * that language (via metadata search) and narrow `sourcePaths` accordingly,
   * intersecting with any caller-provided paths.
   */
  private async resolveLanguageScope(options: RetrievalOptions): Promise<RetrievalOptions> {
    if (!options.language || !this.inventory) {
      return options;
    }
    const page = await this.inventory.searchIndexByMetadata({
      language: options.language,
      limit: LANGUAGE_SCOPE_LIMIT,
    });
    const languagePaths = page.items.map((item) => item.sourcePath);
    const sourcePaths = options.sourcePaths
      ? options.sourcePaths.filter((path) => languagePaths.includes(path))
      : languagePaths;
    return { ...options, sourcePaths };
  }

  async getLanguageInventory(): Promise<LanguageInventoryItem[]> {
    return this.languageInventory?.getLanguageInventory() ?? [];
  }

  async listIndexedUrls(options: IndexedUrlInventoryOptions): Promise<IndexedUrlInventoryResult> {
    if (!this.chunkInventory) {
      return { items: [] };
    }
    return this.listIndexedUrlsFromStore(this.chunkInventory, options);
  }

  async listIndexSources(options: IndexSourceInventoryOptions) {
    return this.inventory?.listIndexSources(options) ?? { items: [] };
  }

  async listIndexChunks(options: IndexChunkListOptions) {
    return this.inventory?.listIndexChunks(options) ?? { items: [] };
  }

  async readIndexChunk(options: IndexChunkReadOptions) {
    return this.inventory?.readIndexChunk(options) ?? { chunks: [] };
  }

  async readIndexSection(options: IndexSectionReadOptions) {
    return this.inventory?.readIndexSection(options) ?? null;
  }

  async getSourceMetadata(sourcePath: string) {
    return this.documentMetadata?.read(sourcePath) ?? null;
  }

  async getSourceSummary(sourcePath: string) {
    return this.documentSummaries?.read(sourcePath) ?? null;
  }

  async findClaims(options: FindClaimsOptions): Promise<ClaimGroup[]> {
    if (!this.documentClaims) {
      return [];
    }
    return groupClaims(await this.documentClaims.list(), options);
  }

  async listSharedReferences(options: { minSources: number }): Promise<SharedReference[]> {
    if (!this.documentMetadata) {
      return [];
    }
    return sharedReferences(await this.documentMetadata.list(), options.minSources);
  }

  async findInIndex(options: FindInIndexOptions) {
    return this.inventory?.findInIndex(options) ?? { items: [] };
  }

  async summarizeIndexSource(sourcePath: string, maxSections: number) {
    return this.inventory?.summarizeIndexSource(sourcePath, maxSections) ?? null;
  }

  async getIndexSourceOutline(sourcePath: string) {
    return this.inventory?.getIndexSourceOutline(sourcePath) ?? null;
  }

  async searchIndexByMetadata(options: IndexMetadataSearchOptions) {
    return this.inventory?.searchIndexByMetadata(options) ?? { items: [] };
  }

  /**
   * Run one retrieval pass over a group of queries: a single batched embedding
   * call, then bounded-concurrency index and keyword lookups. Chunks are
   * returned in query order so fusion stays independent of completion order.
   */
  private async searchQueries(
    queries: string[],
    candidateLimit: number,
    scoped: RetrievalOptions,
  ): Promise<QueryPassResult> {
    if (queries.length === 0) {
      return { semanticChunks: [], keywordChunks: [] };
    }

    const [semantic, keyword] = await Promise.all([
      this.searchSemantic(queries, candidateLimit, scoped.signal),
      mapWithConcurrency(queries, KEYWORD_SEARCH_CONCURRENCY, (query) =>
        this.searchKeywords(query, { ...scoped, limit: candidateLimit }),
      ),
    ]);

    return {
      semanticChunks: semantic.chunksByQuery.flatMap((chunks) =>
        filterRetrievedChunks(chunks, scoped),
      ),
      keywordChunks: keyword.flatMap((chunks) => filterRetrievedChunks(chunks, scoped)),
      ...(semantic.error ? { semanticError: semantic.error } : {}),
    };
  }

  /**
   * Semantic search never throws: retrieval degrades to keyword-only ranking.
   * The failure reason is returned (not swallowed) so callers can surface the
   * degradation — a silent catch here previously hid rebuild-required and
   * embedding-provider errors behind seemingly normal keyword results.
   */
  private async searchSemantic(
    queries: string[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<{ chunksByQuery: RetrievedChunk[][]; error?: string }> {
    try {
      const response = await this.embeddings.embed({
        model: this.embeddingModel,
        input: queries,
        ...(signal ? { signal } : {}),
      });
      const first = response.embeddings[0];

      if (!first) {
        return { chunksByQuery: [], error: "embedding provider returned no embedding" };
      }

      await this.indexStore.initialize({
        embeddingModel: this.embeddingModel,
        embeddingDimensions: first.length,
      });

      const chunksByQuery = await mapWithConcurrency(
        queries,
        INDEX_QUERY_CONCURRENCY,
        async (_query, index) => {
          const embedding = response.embeddings[index];
          return embedding ? this.indexStore.query(embedding, limit) : [];
        },
      );
      const missing = response.embeddings.length < queries.length;

      return {
        chunksByQuery,
        ...(missing ? { error: "embedding provider returned no embedding" } : {}),
      };
    } catch (error) {
      return { chunksByQuery: [], error: describeSemanticError(error) };
    }
  }

  private async searchKeywords(
    query: string,
    options: RetrievalOptions,
  ): Promise<RetrievedChunk[]> {
    return this.keyword?.searchKeywords(query, options) ?? [];
  }

  private async listIndexedUrlsFromStore(
    chunkInventory: IndexChunkInventoryStore,
    options: IndexedUrlInventoryOptions,
  ): Promise<IndexedUrlInventoryResult> {
    const batch = await chunkInventory.listIndexedChunks({
      limit: Number.MAX_SAFE_INTEGER,
      ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
    });
    const start = parseCursor(options.cursor);
    const refs = indexedUrlReferences(batch.chunks);
    const items = refs.slice(start, start + options.limit);
    const next = start + items.length;

    return {
      items,
      ...(next < refs.length ? { nextCursor: String(next) } : {}),
    };
  }
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;
const CONTEXT_CHARS = 180;

function indexedUrlReferences(
  chunks: readonly RetrievedChunk[],
  sourcePath?: string,
): IndexedUrlReference[] {
  const refs: IndexedUrlReference[] = [];

  for (const chunk of chunks) {
    if (sourcePath && sourcePathFor(chunk.source) !== sourcePath) {
      continue;
    }

    let match: RegExpExecArray | null;
    URL_PATTERN.lastIndex = 0;
    let indexInChunk = 0;
    while ((match = URL_PATTERN.exec(chunk.text)) !== null) {
      const url = stripTrailingPunctuation(match[0]);
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) {
        continue;
      }
      const context = extractContext(chunk.text, match.index, url.length);
      refs.push({
        id: `${chunk.id}:url:${indexInChunk}`,
        url,
        normalizedUrl,
        purpose: purposeFromContext(context, url),
        context,
        chunkId: chunk.id,
        source: chunk.source,
      });
      indexInChunk += 1;
    }
  }

  return refs;
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sourcePathFor(source: SourceReference): string | undefined {
  return "path" in source ? source.path : undefined;
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

function normalizeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function extractContext(text: string, start: number, length: number): string {
  const left = Math.max(0, start - CONTEXT_CHARS);
  const right = Math.min(text.length, start + length + CONTEXT_CHARS);
  return text.slice(left, right).replace(/\s+/g, " ").trim();
}

function purposeFromContext(context: string, url: string): string | null {
  const escapedUrl = escapeRegExp(url);
  const withoutUrl = context.replace(new RegExp(escapedUrl, "g"), "").replace(/\s+/g, " ").trim();
  if (!withoutUrl) {
    return null;
  }
  const sentence = nearestSentence(withoutUrl);
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

function nearestSentence(value: string): string {
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length === 0) return value;
  return sentences.reduce((best, current) =>
    Math.abs(current.length - 120) < Math.abs(best.length - 120) ? current : best,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LANGUAGE_SCOPE_LIMIT = 1000;
const MAX_FUSED_QUERIES = 8;
const KEYWORD_SEARCH_CONCURRENCY = 4;
const BOOSTED_SOURCE_WEIGHT = 0.2;
const CANDIDATE_OVER_FETCH = 4;
const BOOSTED_CANDIDATE_OVER_FETCH = 8;
const INDEX_QUERY_CONCURRENCY = 4;

interface QueryPassResult {
  semanticChunks: RetrievedChunk[];
  keywordChunks: RetrievedChunk[];
  semanticError?: string;
}

function describeSemanticError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

/** Keep only the first (highest-ranked) chunk per source. Input must be score-sorted. */
function oneChunkPerSource(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  const result: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const key = chunk.source.kind === "web" ? chunk.source.url : chunk.source.path;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(chunk);
  }
  return result;
}

function normalizedQueries(queries: string[]): string[] {
  const normalized = queries.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);

  return Array.from(new Set(normalized)).slice(0, MAX_FUSED_QUERIES);
}

/** Late or failed query expansion degrades to the original query alone. */
async function resolveQueryVariants(
  variants: RetrievalOptions["queryVariants"],
): Promise<RetrievalQueryVariant[]> {
  try {
    return (await variants) ?? [];
  } catch {
    return [];
  }
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

/**
 * Deepen the candidate pool while boosting, so that what surfaces is decided by the
 * boost formula rather than by the over-fetch constant. At the default over-fetch a
 * linked note ranked just past the pool is discarded before it can be boosted, even
 * though its boosted score would have placed it in the results.
 */
function candidateOverFetch(options: RetrievalOptions): number {
  return options.boostedSourcePaths?.length ? BOOSTED_CANDIDATE_OVER_FETCH : CANDIDATE_OVER_FETCH;
}

/**
 * Widen an explicit `sourcePaths` filter to also admit the boosted paths. Without
 * this a caller that scopes the search to attached files would filter out the very
 * linked notes it asked to boost, leaving them unreachable rather than ranked lower.
 */
function withBoostedPathsInScope(options: RetrievalOptions): RetrievalOptions {
  const { sourcePaths, boostedSourcePaths } = options;

  if (!sourcePaths?.length || !boostedSourcePaths || boostedSourcePaths.length === 0) {
    return options;
  }

  return { ...options, sourcePaths: Array.from(new Set([...sourcePaths, ...boostedSourcePaths])) };
}

/**
 * Fold membership in `boostedSourcePaths` into ranking as one more reciprocal-rank
 * signal over the already fused candidates. Linked notes retrieved near the head
 * move ahead of it, while ones ranked far below stay below stronger results.
 */
function boostChunksFromSources(
  chunks: RetrievedChunk[],
  boostedSourcePaths: string[] | undefined,
): RetrievedChunk[] {
  if (!boostedSourcePaths || boostedSourcePaths.length === 0) {
    return chunks;
  }

  const paths = new Set(boostedSourcePaths);
  const boosted = chunks.filter((chunk) => "path" in chunk.source && paths.has(chunk.source.path));

  if (boosted.length === 0) {
    return chunks;
  }

  const scores = new Map(chunks.map((chunk) => [chunk.id, { chunk, score: chunk.score }]));
  addRanked(scores, boosted, BOOSTED_SOURCE_WEIGHT);

  return Array.from(scores.values())
    .sort((left, right) => right.score - left.score)
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
