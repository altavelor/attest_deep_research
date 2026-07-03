import type { FileVectorChunkRow, KeywordPostingRow } from "../store/FileVectorIndexFormat";

export interface KeywordSearchMatch {
  chunkId: string;
  score: number;
}

export interface KeywordPosting {
  chunkId: string;
  frequency: number;
}

/**
 * Query-ready view over posting rows: term lookup plus the corpus statistics
 * BM25 needs (chunk lengths, average length). Built once per committed index
 * state and cached by the caller — ranking must not rescan all rows per query.
 */
export interface KeywordPostingLookup {
  get(term: string): KeywordPosting[] | undefined;
  chunkCount: number;
  averageLength: number;
  lengthOf(chunkId: string): number | undefined;
}

export function buildKeywordPostingLookup(rowsByShard: KeywordPostingRow[][]): KeywordPostingLookup {
  const postingsByTerm = new Map<string, Map<string, number>>();
  const chunkLengths = new Map<string, number>();

  for (const rows of rowsByShard) {
    for (const row of rows) {
      const postings = getOrCreate(postingsByTerm, row.term, () => new Map<string, number>());

      for (const posting of row.postings) {
        postings.set(posting.chunkId, (postings.get(posting.chunkId) ?? 0) + posting.frequency);
        chunkLengths.set(
          posting.chunkId,
          (chunkLengths.get(posting.chunkId) ?? 0) + posting.frequency,
        );
      }
    }
  }

  const materialized = new Map<string, KeywordPosting[]>();
  for (const [term, postings] of postingsByTerm) {
    materialized.set(
      term,
      Array.from(postings.entries()).map(([chunkId, frequency]) => ({ chunkId, frequency })),
    );
  }

  let totalLength = 0;
  for (const length of chunkLengths.values()) {
    totalLength += length;
  }

  return {
    get: (term) => materialized.get(term),
    chunkCount: chunkLengths.size,
    averageLength: chunkLengths.size > 0 ? totalLength / chunkLengths.size : 0,
    lengthOf: (chunkId) => chunkLengths.get(chunkId),
  };
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

/** Convenience over {@link rankKeywordLookup} for callers holding raw rows (tests). */
export function rankKeywordPostings(
  query: string,
  rows: KeywordPostingRow[],
  minTokenLength: number,
  limit: number,
): KeywordSearchMatch[] {
  return rankKeywordLookup(query, buildKeywordPostingLookup([rows]), minTokenLength, limit);
}

// BM25 поверх lookup-а. IDF гасит стоп-слова ("the", "with"), нормализация по
// длине не даёт длинным чанкам выигрывать за счёт объёма — сырой TF-скоринг
// страдал и тем, и другим.
export function rankKeywordLookup(
  query: string,
  lookup: KeywordPostingLookup,
  minTokenLength: number,
  limit: number,
): KeywordSearchMatch[] {
  if (limit <= 0 || lookup.chunkCount === 0) {
    return [];
  }

  const queryTerms = new Set(tokenizeForKeywordIndex(query, minTokenLength));

  if (queryTerms.size === 0) {
    return [];
  }

  const scores = new Map<string, number>();

  for (const term of queryTerms) {
    const postings = lookup.get(term);

    if (!postings || postings.length === 0) {
      continue;
    }

    const idf = Math.log(
      1 + (lookup.chunkCount - postings.length + 0.5) / (postings.length + 0.5),
    );

    for (const posting of postings) {
      const length = lookup.lengthOf(posting.chunkId) ?? lookup.averageLength;
      const saturation =
        (posting.frequency * (BM25_K1 + 1)) /
        (posting.frequency +
          BM25_K1 * (1 - BM25_B + (BM25_B * length) / lookup.averageLength));

      scores.set(posting.chunkId, (scores.get(posting.chunkId) ?? 0) + idf * saturation);
    }
  }

  return Array.from(scores.entries())
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
    .slice(0, limit);
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
