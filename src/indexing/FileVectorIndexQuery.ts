import { SourceReference, RetrievedChunk } from "../shared/types";
import { chunkMatchesRetrievalOptions } from "../retrieval/retrievalFilters";
import { readJsonlIndexFile } from "./fileIndexFiles";
import { FileVectorChunkRow, isKeywordPostingRow, KeywordPostingRow } from "./FileVectorIndexFormat";
import { throwRebuildRequired } from "./FileVectorIndexErrors";
import type { FileVectorIndexState, StoredChunk } from "./FileVectorIndexState";
import { dotProduct, normalizeVector, sourcePathFromReference } from "./FileVectorIndexVector";
import { mergeKeywordPostingRows, rankKeywordPostings } from "./LightweightKeywordIndex";

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

  const matches = rankKeywordPostings(
    query,
    mergeKeywordPostingRows(rowsByShard),
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

export function expandAdjacentFileVectorChunks(
  state: FileVectorIndexState,
  chunks: RetrievedChunk[],
  radius: number,
  limit: number,
): RetrievedChunk[] {
  if (radius <= 0 || chunks.length === 0 || limit <= 0) {
    return chunks.slice(0, limit);
  }

  const byId = new Map<string, StoredChunk>();
  const bySourcePath = new Map<string, StoredChunk[]>();

  for (const shardChunks of state.chunksByShard.values()) {
    for (const chunk of shardChunks) {
      const sourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
      byId.set(chunk.row.id, chunk);
      const sourceChunks = bySourcePath.get(sourcePath) ?? [];
      sourceChunks.push(chunk);
      bySourcePath.set(sourcePath, sourceChunks);
    }
  }

  for (const sourceChunks of bySourcePath.values()) {
    sourceChunks.sort((left, right) => (left.row.chunkIndex ?? 0) - (right.row.chunkIndex ?? 0));
  }

  const expanded: RetrievedChunk[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const stored = byId.get(chunk.id);

    if (!stored) {
      appendChunk(chunk);
      continue;
    }

    const sourcePath = stored.row.sourcePath ?? sourcePathFromReference(stored.row.source);
    const sourceChunks = bySourcePath.get(sourcePath) ?? [];
    const index = sourceChunks.findIndex((candidate) => candidate.row.id === chunk.id);
    const start = Math.max(0, index - radius);
    const end = Math.min(sourceChunks.length, index + radius + 1);

    for (const candidate of sourceChunks.slice(start, end)) {
      appendChunk({
        id: candidate.row.id,
        source: candidate.row.source,
        text: candidate.row.text,
        contentHash: candidate.row.contentHash,
        score: candidate.row.id === chunk.id ? chunk.score : chunk.score * 0.98,
      });
    }

    if (expanded.length >= limit) {
      break;
    }
  }

  return expanded.slice(0, limit);

  function appendChunk(chunk: RetrievedChunk): void {
    if (seen.has(chunk.id) || expanded.length >= limit) {
      return;
    }

    seen.add(chunk.id);
    expanded.push(chunk);
  }
}
