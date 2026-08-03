import { RetrievedChunk, SourceReference } from "./../model/source";

const SHINGLE_SIZE = 8;
const JACCARD_THRESHOLD = 0.5;

const SHORT_TEXT_THRESHOLD = 0.9;
const MAX_COMPARE_CHARS = 4_000;

interface Kept {
  chunk: RetrievedChunk;
  shingles: Set<string>;
  tokenCount: number;
  duplicates: string[];
}

/**
 * Suppress near-duplicate chunks, preserving input (score) order. Each survivor's
 * `duplicates` lists the distinct sourcePaths of the copies it absorbed. Chunks are
 * compared pairwise against already-kept survivors, so the highest-ranked copy wins.
 */
export function dedupeNearDuplicateChunks(chunks: readonly RetrievedChunk[]): RetrievedChunk[] {
  const kept: Kept[] = [];

  for (const chunk of chunks) {
    const shingles = shingleSet(chunk.text);
    const tokenCount = tokenize(chunk.text).length;
    const match = kept.find((candidate) => isNearDuplicate(candidate, shingles, tokenCount));
    if (match) {
      const path = sourcePath(chunk.source);
      if (path && path !== sourcePath(match.chunk.source) && !match.duplicates.includes(path)) {
        match.duplicates.push(path);
      }
      continue;
    }
    kept.push({ chunk, shingles, tokenCount, duplicates: [] });
  }

  return kept.map((entry) =>
    entry.duplicates.length > 0 ? { ...entry.chunk, duplicates: entry.duplicates } : entry.chunk,
  );
}

function isNearDuplicate(kept: Kept, shingles: Set<string>, tokenCount: number): boolean {
  if (kept.tokenCount < SHINGLE_SIZE || tokenCount < SHINGLE_SIZE) {
    return jaccard(kept.shingles, shingles) >= SHORT_TEXT_THRESHOLD;
  }
  return jaccard(kept.shingles, shingles) >= JACCARD_THRESHOLD;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) {
      intersection += 1;
    }
  }
  return intersection / (a.size + b.size - intersection);
}

function shingleSet(text: string): Set<string> {
  const tokens = tokenize(text);
  const result = new Set<string>();
  if (tokens.length < SHINGLE_SIZE) {
    for (const token of tokens) {
      result.add(token);
    }
    return result;
  }
  for (let index = 0; index + SHINGLE_SIZE <= tokens.length; index += 1) {
    result.add(tokens.slice(index, index + SHINGLE_SIZE).join(" "));
  }
  return result;
}

function tokenize(text: string): string[] {
  return text
    .slice(0, MAX_COMPARE_CHARS)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function sourcePath(source: SourceReference): string | null {
  return source.kind === "web" ? null : source.path;
}
