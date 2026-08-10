import {
  buildKeywordPostingLookup,
  FileVectorIndexReader,
  FileVectorIndexStore,
  KeywordPostingRow,
  rankKeywordLookup,
} from "@adapters/indexing";
import { EmbeddedChunk, SourceReference } from "@core/model";

import { MemoryFileSystem } from "../helpers/memoryFileSystem";

describe("keyword search at corpus scale (Ф0)", () => {
  it("ranks a 50k-chunk lookup well under the latency budget", () => {
    const lookup = buildKeywordPostingLookup([syntheticRows(50_000)]);

    const durations: number[] = [];
    for (let run = 0; run < 20; run += 1) {
      const startedAt = performance.now();
      const matches = rankKeywordLookup("riquet tuft fairy tale the with", lookup, 3, 20);
      durations.push(performance.now() - startedAt);
      expect(matches.length).toBeGreaterThan(0);
    }

    durations.sort((left, right) => left - right);
    const p50 = durations[Math.floor(durations.length / 2)];
    expect(p50).toBeLessThan(150);
  });

  it("serves repeat queries from the cached lookup without re-reading keyword files", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".ixplorer/index";
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
    const folder = ".ixplorer/index";
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

/**
 * ~50k chunks over a realistic Zipf-ish vocabulary: a handful of stopwords in
 * every chunk, a long tail of rare terms, and one target chunk carrying the
 * rare query terms.
 */
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
    add(`rare-${index % 5_000}`, chunkId, 2);
    add(`tail-${index}`, chunkId, 1);
    if (index % 10_000 === 0) {
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
