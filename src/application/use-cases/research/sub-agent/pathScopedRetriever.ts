import type { ResearchRetriever } from "@application/contracts/research";
import type { IndexCursorPage } from "@application/ports/retrieval";

/**
 * Wraps a retriever so that every index read stays inside the granted paths: folders and
 * their documents, or with exact scope only the granted documents themselves. Queries are
 * narrowed to a single granted path, other documents read as nothing, and a page that lost
 * items keeps neither its cursor nor its count, so it reveals nothing about other documents.
 */
export function pathScopedRetriever(
  retriever: ResearchRetriever,
  paths: readonly string[],
  exact = false,
): ResearchRetriever {
  const allowed = (path: string | undefined): boolean =>
    typeof path === "string" &&
    paths.some((granted) => path === granted || (!exact && path.startsWith(`${granted}/`)));
  const only = paths.length === 1 ? paths[0] : undefined;
  const page = <T extends { sourcePath: string }>(
    result: IndexCursorPage<T>,
    narrowed: boolean,
  ): IndexCursorPage<T> => {
    const items = result.items.filter((item) => allowed(item.sourcePath));
    if (items.length !== result.items.length || !narrowed) return { items };
    return {
      items,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      ...(result.totalCount !== undefined ? { totalCount: result.totalCount } : {}),
    };
  };
  const scoped: ResearchRetriever = {
    search: async (query, options) => {
      const requested = options.sourcePaths?.filter(allowed) ?? [...paths];
      if (requested.length === 0) return { chunks: [], citations: [], usedFallback: false };
      const result = await retriever.search(query, { ...options, sourcePaths: requested });
      const chunks = result.chunks.filter((chunk) =>
        allowed("path" in chunk.source ? chunk.source.path : undefined),
      );
      const ids = new Set(chunks.map((chunk) => chunk.id));
      return {
        ...result,
        chunks,
        citations: result.citations.filter((entry) => ids.has(entry.id)),
      };
    },
  };
  if (retriever.listIndexedUrls) {
    scoped.listIndexedUrls = async (options) => {
      if (options.sourcePath !== undefined && !allowed(options.sourcePath)) return { items: [] };
      const result = await retriever.listIndexedUrls!(options);
      return {
        ...result,
        items: result.items.filter((item) =>
          allowed("path" in item.source ? item.source.path : undefined),
        ),
      };
    };
  }
  if (retriever.listIndexSources) {
    scoped.listIndexSources = async (options) =>
      page(
        await retriever.listIndexSources!(
          only !== undefined ? { ...options, pathPrefix: only } : options,
        ),
        only !== undefined,
      );
  }
  if (retriever.searchIndexByMetadata) {
    scoped.searchIndexByMetadata = async (options) =>
      page(
        await retriever.searchIndexByMetadata!(
          only !== undefined ? { ...options, pathPrefix: only } : options,
        ),
        only !== undefined,
      );
  }
  if (retriever.listIndexChunks) {
    scoped.listIndexChunks = async (options) =>
      allowed(options.sourcePath) ? retriever.listIndexChunks!(options) : { items: [] };
  }
  if (retriever.findInIndex) {
    scoped.findInIndex = async (options) => {
      if (options.sourcePath !== undefined && !allowed(options.sourcePath)) return { items: [] };
      const sourcePath = options.sourcePath ?? only;
      return page(
        await retriever.findInIndex!(
          sourcePath !== undefined ? { ...options, sourcePath } : options,
        ),
        sourcePath !== undefined,
      );
    };
  }
  if (retriever.readIndexChunk) {
    scoped.readIndexChunk = async (options) => {
      const result = await retriever.readIndexChunk!(options);
      return { chunks: result.chunks.filter((chunk) => allowed(chunk.sourcePath)) };
    };
  }
  if (retriever.readIndexSection) {
    scoped.readIndexSection = async (options) => {
      const result = await retriever.readIndexSection!(options);
      return result && allowed(result.sourcePath) ? result : null;
    };
  }
  const source = retriever;
  if (source.getSourceMetadata) {
    scoped.getSourceMetadata = async (path) =>
      allowed(path) ? source.getSourceMetadata!(path) : null;
  }
  if (source.getSourceSummary) {
    scoped.getSourceSummary = async (path) =>
      allowed(path) ? source.getSourceSummary!(path) : null;
  }
  if (source.summarizeIndexSource) {
    scoped.summarizeIndexSource = async (path, maxSections) =>
      allowed(path) ? source.summarizeIndexSource!(path, maxSections) : null;
  }
  if (source.getIndexSourceOutline) {
    scoped.getIndexSourceOutline = async (path) =>
      allowed(path) ? source.getIndexSourceOutline!(path) : null;
  }
  return scoped;
}
