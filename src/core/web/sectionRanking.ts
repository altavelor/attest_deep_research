export interface RankedSection {
  text: string;
  score: number;

  index: number;
}

export interface SectionRankingOptions {
  sentencesPerSection?: number;

  limit?: number;
}

const DEFAULT_SENTENCES_PER_SECTION = 3;
const DEFAULT_LIMIT = 5;

/**
 * Split `text` into sentence-window sections, score each by how many distinct
 * query terms it contains, and return the top `limit` sections in reading order.
 * Sections with no query-term overlap are dropped. When the query yields no
 * usable terms, the leading sections are returned (score 0) as a sensible head.
 */
export function rankSectionsByQuery(
  text: string,
  query: string,
  options: SectionRankingOptions = {},
): RankedSection[] {
  const sentencesPerSection = Math.max(
    1,
    options.sentencesPerSection ?? DEFAULT_SENTENCES_PER_SECTION,
  );
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);

  const sections = splitIntoSections(text, sentencesPerSection);
  if (sections.length === 0) {
    return [];
  }

  const terms = queryTerms(query);
  const scored = sections.map((section, index) => ({
    text: section,
    index,
    score: terms.length === 0 ? 0 : scoreSection(section, terms),
  }));

  const selected =
    terms.length === 0
      ? scored.slice(0, limit)
      : scored
          .filter((section) => section.score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .slice(0, limit)
          .sort((a, b) => a.index - b.index);

  return selected;
}

/** Split collapsed text into windows of `sentencesPerSection` sentences. */
export function splitIntoSections(text: string, sentencesPerSection: number): string[] {
  const sentences = splitSentences(text)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const sections: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerSection) {
    sections.push(sentences.slice(i, i + sentencesPerSection).join(" "));
  }
  return sections;
}

function scoreSection(section: string, terms: string[]): number {
  const haystack = section.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }
  return score;
}

function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const token of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length >= 3) {
      seen.add(token);
    }
  }
  return [...seen];
}
import { splitSentences } from "./sentenceBoundaries";
