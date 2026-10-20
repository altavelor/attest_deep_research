import {
  buildKeywordPostingLookup,
  FileVectorIndexReader,
  FileVectorIndexStore,
  KeywordPostingRow,
  rankKeywordLookup,
} from "@adapters/indexing";
import { EmbeddedChunk, SourceReference } from "@core/model";

import { MemoryFileSystem } from "../support/memoryFileSystem";

describe("keyword lookup cache", () => {
  it("ranks the chunk carrying the rare query terms first in a stopword-heavy corpus", () => {
    const lookup = buildKeywordPostingLookup([syntheticRows(2_000)]);

    const matches = rankKeywordLookup("riquet tuft fairy tale the with", lookup, 3, 20);

    expect(matches[0]?.chunkId).toBe("chunk-42");
  });

  it("serves repeat queries from the cached lookup without re-reading keyword files", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const store = new FileVectorIndexStore({ fileSystem, folder, profileId: "default" });
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([
      chunk("chunk-a", "Research/a.md", "local model local retrieval", [1, 0]),
      chunk("chunk-b", "Research/b.md", "remote server notes", [0, 1]),
    ]);

    const reader = new FileVectorIndexReader(store, store);
    const options = { limit: 5, includeWebResults: false };

    const first = await reader.searchKeywords("local retrieval", options);
    expect(first.map((result) => result.id)).toEqual(["chunk-a"]);

    await fileSystem.removeFolder(`${folder}/keywords`, { recursive: true });

    const second = await reader.searchKeywords("local retrieval", options);
    expect(second.map((result) => result.id)).toEqual(["chunk-a"]);
  });

  it("invalidates the cached lookup after a commit changes the index", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".attest/index";
    const store = new FileVectorIndexStore({ fileSystem, folder, profileId: "default" });
    await store.initialize({ embeddingModel: "nomic", embeddingDimensions: 2 });
    await store.upsert([chunk("chunk-a", "Research/a.md", "local model", [1, 0])]);

    const reader = new FileVectorIndexReader(store, store);
    const options = { limit: 5, includeWebResults: false };
    expect(await reader.searchKeywords("local", options)).toHaveLength(1);

    await store.deleteBySourcePath("Research/a.md");
    await store.upsert([chunk("chunk-b", "Research/b.md", "remote server", [0, 1])]);

    expect(await reader.searchKeywords("local", options)).toHaveLength(0);
    expect((await reader.searchKeywords("remote", options)).map((r) => r.id)).toEqual(["chunk-b"]);
  });
});

/** Builds postings where every chunk shares stopwords and one chunk carries the rare query terms. */
function syntheticRows(chunkCount: number): KeywordPostingRow[] {
  const postingsByTerm = new Map<string, Array<{ chunkId: string; frequency: number }>>();
  const add = (term: string, chunkId: string, frequency: number) => {
    const postings = postingsByTerm.get(term) ?? [];
    postings.push({ chunkId, frequency });
    postingsByTerm.set(term, postings);
  };

  for (let index = 0; index < chunkCount; index += 1) {
    const chunkId = `chunk-${index}`;
    add("the", chunkId, 12);
    add("with", chunkId, 4);
    add(`tail-${index}`, chunkId, 1);
    if (index % 500 === 0) {
      add("fairy", chunkId, 1);
      add("tale", chunkId, 1);
    }
  }
  add("riquet", "chunk-42", 3);
  add("tuft", "chunk-42", 2);

  return Array.from(postingsByTerm.entries()).map(([term, postings]) => ({ term, postings }));
}

function chunk(id: string, path: string, text: string, embedding: number[]): EmbeddedChunk {
  const source: SourceReference = {
    id: `source-${id}`,
    kind: "markdown",
    title: path,
    path,
    headingPath: [],
  };
  return {
    id,
    source,
    text,
    contentHash: `hash-${id}`,
    embedding,
    embeddingModel: "nomic",
  };
}
