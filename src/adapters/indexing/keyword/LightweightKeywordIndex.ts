import type { FileVectorChunkRow, KeywordPostingRow } from "../store/FileVectorIndexFormat";

export interface KeywordSearchMatch {
  chunkId: string;
  score: number;
}

export function tokenizeForKeywordIndex(text: string, minTokenLength: number): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= minTokenLength);
}

export function buildKeywordPostingRows(
  chunks: FileVectorChunkRow[],
  minTokenLength: number,
): KeywordPostingRow[] {
  const terms = new Map<string, Map<string, number>>();

  for (const chunk of chunks) {
    for (const token of tokenizeForKeywordIndex(chunk.text, minTokenLength)) {
      const postings = getOrCreate(terms, token, () => new Map<string, number>());
      postings.set(chunk.id, (postings.get(chunk.id) ?? 0) + 1);
    }
  }

  return Array.from(terms.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, postings]) => ({
      term,
      postings: Array.from(postings.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([chunkId, frequency]) => ({ chunkId, frequency })),
    }));
}

export function countIndexedKeywordChunks(rows: KeywordPostingRow[]): number {
  const chunkIds = new Set<string>();

  for (const row of rows) {
    for (const posting of row.postings) {
      chunkIds.add(posting.chunkId);
    }
  }

  return chunkIds.size;
}

// Классика BM25: k1 — насыщение частоты терма, b — доля нормализации по длине.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function rankKeywordPostings(
  query: string,
  rows: KeywordPostingRow[],
  minTokenLength: number,
  limit: number,
): KeywordSearchMatch[] {
  if (limit <= 0) {
    return [];
  }

  const queryTerms = new Set(tokenizeForKeywordIndex(query, minTokenLength));

  if (queryTerms.size === 0) {
    return [];
  }

  // BM25 поверх posting-строк. Статистика корпуса (длины чанков, средняя длина,
  // число чанков) выводится из самих строк, поэтому формат индекса не меняется.
  // IDF гасит стоп-слова ("the", "with"), нормализация по длине не даёт длинным
  // чанкам выигрывать за счёт объёма — сырой TF-скоринг страдал и тем, и другим.
  const chunkLengths = new Map<string, number>();

  for (const row of rows) {
    for (const posting of row.postings) {
      chunkLengths.set(
        posting.chunkId,
        (chunkLengths.get(posting.chunkId) ?? 0) + posting.frequency,
      );
    }
  }

  const chunkCount = chunkLengths.size;

  if (chunkCount === 0) {
    return [];
  }

  let totalLength = 0;
  for (const length of chunkLengths.values()) {
    totalLength += length;
  }
  const averageLength = totalLength / chunkCount;

  const scores = new Map<string, number>();

  for (const row of rows) {
    if (!queryTerms.has(row.term)) {
      continue;
    }

    const documentFrequency = row.postings.length;
    const idf = Math.log(
      1 + (chunkCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
    );

    for (const posting of row.postings) {
      const length = chunkLengths.get(posting.chunkId) ?? averageLength;
      const saturation =
        (posting.frequency * (BM25_K1 + 1)) /
        (posting.frequency + BM25_K1 * (1 - BM25_B + (BM25_B * length) / averageLength));

      scores.set(posting.chunkId, (scores.get(posting.chunkId) ?? 0) + idf * saturation);
    }
  }

  return Array.from(scores.entries())
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
    .slice(0, limit);
}

export function mergeKeywordPostingRows(rowsByShard: KeywordPostingRow[][]): KeywordPostingRow[] {
  const merged = new Map<string, Map<string, number>>();

  for (const rows of rowsByShard) {
    for (const row of rows) {
      const postings = getOrCreate(merged, row.term, () => new Map<string, number>());

      for (const posting of row.postings) {
        postings.set(posting.chunkId, (postings.get(posting.chunkId) ?? 0) + posting.frequency);
      }
    }
  }

  return Array.from(merged.entries()).map(([term, postings]) => ({
    term,
    postings: Array.from(postings.entries()).map(([chunkId, frequency]) => ({
      chunkId,
      frequency,
    })),
  }));
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const created = create();
  map.set(key, created);
  return created;
}
