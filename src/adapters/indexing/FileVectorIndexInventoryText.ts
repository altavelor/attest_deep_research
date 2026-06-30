import { FindInIndexMatch, FindInIndexOptions } from "../../application/ports/retrieval";
import type { StoredChunk } from "./FileVectorIndexState";

export type IndexTextMatcher = RegExp | {
  kind: "literal";
  pattern: string;
  caseSensitive: boolean;
};

export function createIndexMatcher(options: FindInIndexOptions): IndexTextMatcher | null {
  if (options.mode === "literal") {
    return {
      kind: "literal",
      pattern: options.caseSensitive ? options.pattern : options.pattern.toLocaleLowerCase(),
      caseSensitive: options.caseSensitive === true,
    };
  }
  try {
    return new RegExp(options.pattern, options.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

export function matchesInChunk(
  chunk: StoredChunk,
  sourcePath: string,
  matcher: IndexTextMatcher,
): FindInIndexMatch[] {
  if (!(matcher instanceof RegExp)) {
    const text = matcher.caseSensitive ? chunk.row.text : chunk.row.text.toLocaleLowerCase();
    const matches: FindInIndexMatch[] = [];
    let start = text.indexOf(matcher.pattern);
    while (start !== -1) {
      const end = start + matcher.pattern.length;
      matches.push(toFindMatch(chunk, sourcePath, start, end, matches.length));
      start = text.indexOf(matcher.pattern, Math.max(end, start + 1));
    }
    return matches;
  }

  const matches: FindInIndexMatch[] = [];
  matcher.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(chunk.row.text)) !== null) {
    const value = match[0];
    if (value.length === 0) {
      matcher.lastIndex += 1;
      continue;
    }
    matches.push(toFindMatch(chunk, sourcePath, match.index, match.index + value.length, matches.length));
  }
  return matches;
}

export function frequentTerms(texts: string[]): Array<{ term: string; count: number }> {
  const stop = new Set([
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
    "или", "для", "что", "как", "это",
  ]);
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const term of text.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
      if (!stop.has(term)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([term, count]) => ({ term, count }));
}

function toFindMatch(
  chunk: StoredChunk,
  sourcePath: string,
  start: number,
  end: number,
  index: number,
): FindInIndexMatch {
  const contextStart = Math.max(0, start - 120);
  const contextEnd = Math.min(chunk.row.text.length, end + 120);
  return {
    id: `${chunk.row.id}:match:${index}`,
    chunkId: chunk.row.id,
    sourcePath,
    chunkIndex: chunk.row.chunkIndex ?? 0,
    start,
    end,
    match: chunk.row.text.slice(start, end),
    context: chunk.row.text.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim(),
    source: chunk.row.source,
  };
}
