import {
  FindInIndexOptions,
  IndexChunkListOptions,
  IndexChunkReadOptions,
  IndexInventoryStore,
  IndexMetadataSearchOptions,
  IndexSourceInventoryOptions,
} from "../../application/ports/retrieval";
import {
  findInFileVectorIndex,
  getFileVectorIndexSourceOutline,
  listFileVectorIndexChunks,
  listFileVectorIndexSources,
  readFileVectorIndexChunk,
  searchFileVectorIndexByMetadata,
  summarizeFileVectorIndexSource,
} from "./FileVectorIndexInventory";
import type { FileVectorStateAccess } from "./FileVectorIndexState";

/**
 * Read-only inventory capability over a file-backed index. Lives separately from
 * the write/query store so neither class carries the other's responsibilities;
 * it reads committed state through the injected {@link FileVectorStateAccess},
 * sharing the store's in-memory cache.
 */
export class FileVectorInventoryStore implements IndexInventoryStore {
  constructor(private readonly state: FileVectorStateAccess) {}

  listIndexSources(options: IndexSourceInventoryOptions) {
    return this.state.withState({ items: [] }, (state) =>
      listFileVectorIndexSources(state, options),
    );
  }

  listIndexChunks(options: IndexChunkListOptions) {
    return this.state.withState({ items: [] }, (state) =>
      listFileVectorIndexChunks(state, options),
    );
  }

  readIndexChunk(options: IndexChunkReadOptions) {
    return this.state.withState({ chunks: [] }, (state) =>
      readFileVectorIndexChunk(state, options),
    );
  }

  findInIndex(options: FindInIndexOptions) {
    return this.state.withState({ items: [] }, (state) =>
      findInFileVectorIndex(state, options),
    );
  }

  summarizeIndexSource(sourcePath: string, maxSections: number) {
    return this.state.withState(null, (state) =>
      summarizeFileVectorIndexSource(state, sourcePath, maxSections),
    );
  }

  getIndexSourceOutline(sourcePath: string) {
    return this.state.withState(null, (state) =>
      getFileVectorIndexSourceOutline(state, sourcePath),
    );
  }

  searchIndexByMetadata(options: IndexMetadataSearchOptions) {
    return this.state.withState({ items: [] }, (state) =>
      searchFileVectorIndexByMetadata(state, options),
    );
  }
}
