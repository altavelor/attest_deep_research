// Keyword ranking for the file-vector retrieval engine. This is the scoring
// policy of THIS RAG implementation (naive term-frequency over chunk text), not
// a universal domain primitive, so it lives with the retrieval component rather
// than in core. Swapping the engine (BM25, vector, hybrid) replaces this file.

import { RetrievedChunk } from "../../core/model/source";
import { tokenizeForSearch } from "../../core/retrieval/tokenization";

export function rankKeywordMatches(
  query: string,
  chunks: RetrievedChunk[],
  limit: number,
): RetrievedChunk[] {
  const terms = tokenizeForSearch(query);

  if (terms.length === 0) {
    return [];
  }

  return chunks
    .map((chunk) => ({ chunk, score: keywordScore(terms, chunk) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || right.chunk.score - left.chunk.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({ ...chunk, score }));
}

function keywordScore(terms: string[], chunk: RetrievedChunk): number {
  const haystack = chunk.text.toLowerCase();

  return terms.reduce((score, term) => score + countOccurrences(haystack, term), 0);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let offset = 0;

  while (offset < haystack.length) {
    const index = haystack.indexOf(needle, offset);

    if (index === -1) {
      break;
    }

    count += 1;
    offset = index + needle.length;
  }

  return count;
}
