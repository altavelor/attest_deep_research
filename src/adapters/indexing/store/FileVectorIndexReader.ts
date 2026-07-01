import {
  IndexChunkInventoryOptions,
  IndexChunkInventoryStore,
  LanguageInventoryIndexStore,
} from "@application/ports";
import { KeywordSearchIndexStore } from "@application/ports";
import { LanguageInventoryItem } from "@core/model";
import { RetrievedChunk } from "@core/model";
import { RetrievalOptions } from "@core/retrieval";
import { languageInventoryFromStoredChunks } from "./FileVectorIndexLanguage";
import { searchFileVectorKeywords } from "./FileVectorIndexQuery";
import type { FileVectorStateAccess } from "./FileVectorIndexState";
import { sourcePathFromReference } from "./FileVectorIndexVector";

/** Resolves an index-relative path to an absolute path on disk. */
export interface FileVectorPathResolver {
  pathFor(relativePath: string): string;
}

/**
 * Read-only retrieval capabilities over a file-backed index (keyword, chunk
 * inventory, language inventory). Kept separate from the write/lifecycle
 * store; reads committed state through the injected {@link FileVectorStateAccess}
 * so it shares the store's in-memory cache.
 */
export class FileVectorIndexReader
  implements
    KeywordSearchIndexStore,
    IndexChunkInventoryStore,
    LanguageInventoryIndexStore
{
  constructor(
    private readonly state: FileVectorStateAccess,
    private readonly paths: FileVectorPathResolver,
  ) {}

  async getLanguageInventory(): Promise<LanguageInventoryItem[]> {
    return this.state.withState([], (state) => {
      const inventory = state.manifest.languageInventory ?? [];

      if (inventory.length > 0 && inventory.some((item) => item.language !== "unknown")) {
        return [...inventory];
      }

      return languageInventoryFromStoredChunks(state);
    });
  }

  async searchKeywords(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]> {
    return this.state.withState([], (state) =>
      searchFileVectorKeywords(state, query, options, (relativePath) =>
        this.paths.pathFor(relativePath),
      ),
    );
  }

  async listIndexedChunks(
    options: IndexChunkInventoryOptions,
  ): Promise<{ chunks: RetrievedChunk[]; nextCursor?: string }> {
    if (options.limit <= 0) {
      return { chunks: [] };
    }

    return this.state.withState({ chunks: [] as RetrievedChunk[] }, (state) => {
      const start = parseInventoryCursor(options.cursor);
      const rows = [...state.chunksByShard.values()]
        .flat()
        .map((chunk) => chunk.row)
        .filter((row) => !options.sourcePath || row.sourcePath === options.sourcePath)
        .sort((left, right) => {
          const leftPath = left.sourcePath ?? sourcePathFromReference(left.source);
          const rightPath = right.sourcePath ?? sourcePathFromReference(right.source);
          return (
            leftPath.localeCompare(rightPath) ||
            (left.chunkIndex ?? 0) - (right.chunkIndex ?? 0) ||
            left.id.localeCompare(right.id)
          );
        });
      const selected = rows.slice(start, start + options.limit);
      const next = start + selected.length;

      return {
        chunks: selected.map((row) => ({
          id: row.id,
          source: row.source,
          text: row.text,
          contentHash: row.contentHash,
          score: 1,
        })),
        ...(next < rows.length ? { nextCursor: String(next) } : {}),
      };
    });
  }

}

function parseInventoryCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
