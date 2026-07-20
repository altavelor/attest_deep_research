import { RetrievedChunk, SourceReference } from "@core/model";
import { chunkMatchesRetrievalOptions } from "@core/retrieval";
import { readJsonlIndexFile } from "../inventory/fileIndexFiles";
import {
  FileVectorChunkRow,
  isKeywordPostingRow,
  KeywordPostingRow,
} from "./FileVectorIndexFormat";
import { throwRebuildRequired } from "./FileVectorIndexErrors";
import type { FileVectorIndexState } from "./FileVectorIndexState";
import { dotProduct, normalizeVector } from "./FileVectorIndexVector";
import {
  buildKeywordPostingLookup,
  KeywordPostingLookup,
  rankKeywordLookup,
} from "../keyword/LightweightKeywordIndex";

interface KeywordQueryCacheEntry {
  writeId: string;
  loaded: Promise<{
    lookup: KeywordPostingLookup;
    chunkById: Map<string, FileVectorChunkRow>;
  }>;
}

// Merged-постинги и статистика BM25 строятся один раз на закоммиченное
// состояние (каждый commit меняет manifest.writeId) — иначе каждый запрос
// перечитывает keyword-файлы всех шардов с диска, что на десятках тысяч
// чанков занимает секунды. Promise в кэше дедуплицирует конкурентные сборки.
const keywordQueryCache = new WeakMap<FileVectorIndexState, KeywordQueryCacheEntry>();

function keywordQueryDataFor(
  state: FileVectorIndexState,
  pathFor: (relativePath: string) => string,
): KeywordQueryCacheEntry["loaded"] {
  const cached = keywordQueryCache.get(state);

  if (cached && cached.writeId === state.manifest.writeId) {
    return cached.loaded;
  }

  const loaded = (async () => {
    const chunkById = new Map<string, FileVectorChunkRow>();
    const rowsByShard: KeywordPostingRow[][] = [];

    for (const shard of state.manifest.shards) {
      const shardChunks = state.chunksByShard.get(shard.id) ?? [];
      for (const chunk of shardChunks) {
        chunkById.set(chunk.row.id, chunk.row);
      }

      rowsByShard.push(
        await readJsonlIndexFile(pathFor(`keywords/${shard.id}.terms.jsonl`), isKeywordPostingRow),
      );
    }

    return { lookup: buildKeywordPostingLookup(rowsByShard), chunkById };
  })();

  keywordQueryCache.set(state, { writeId: state.manifest.writeId, loaded });
  return loaded;
}

export async function searchFileVectorKeywords(
  state: FileVectorIndexState,
  query: string,
  options: {
    limit: number;
    includeWebResults: boolean;
    minScore?: number;
    sourceKinds?: Array<SourceReference["kind"]>;
    fileExtensions?: string[];
  },
  pathFor: (relativePath: string) => string,
): Promise<RetrievedChunk[]> {
  const { lookup, chunkById } = await keywordQueryDataFor(state, pathFor);

  const matches = rankKeywordLookup(
    query,
    lookup,
    state.manifest.keywordIndex.minTokenLength,
    options.limit * 4,
  );
  const chunks: RetrievedChunk[] = [];

  for (const match of matches) {
    const row = chunkById.get(match.chunkId);

    if (!row) {
      continue;
    }

    const chunk: RetrievedChunk = {
      id: row.id,
      source: row.source,
      text: row.text,
      contentHash: row.contentHash,
      score: match.score,
    };

    if (chunkMatchesRetrievalOptions(chunk, options)) {
      chunks.push(chunk);
    }

    if (chunks.length >= options.limit) {
      break;
    }
  }

  return chunks;
}

export function queryFileVectorState(
  state: FileVectorIndexState,
  embedding: number[],
  limit: number,
): RetrievedChunk[] {
  if (limit <= 0) {
    return [];
  }

  if (embedding.length !== state.manifest.embeddingDimensions) {
    throwRebuildRequired({
      reason: "query-dimensions-mismatch",
      expected: state.manifest.embeddingDimensions,
      actual: embedding.length,
    });
  }

  const queryVector = normalizeVector(embedding);
  const matches: RetrievedChunk[] = [];

  for (const shardChunks of state.chunksByShard.values()) {
    for (const chunk of shardChunks) {
      matches.push({
        id: chunk.row.id,
        source: chunk.row.source,
        text: chunk.row.text,
        contentHash: chunk.row.contentHash,
        score: dotProduct(queryVector, chunk.embedding),
      });
    }
  }

  return matches.sort((left, right) => right.score - left.score).slice(0, limit);
}
