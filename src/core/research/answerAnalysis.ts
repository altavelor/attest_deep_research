import { isMarkdownCodeIndex, markdownCodeRanges } from "./citationTokens";

export interface AnswerCitationOccurrence {
  label: string;
  index: number;
  length: number;
}

export interface AnswerTextAnalysis {
  characters: number;
  words: number;
  sentences: number;
  occurrences: AnswerCitationOccurrence[];
  byLabel: Record<string, number>;
  citedSentences: number;
  maxLabelsPerSentence: number;
}

export function markdownCitationOccurrences(
  text: string,
  allowedLabels: ReadonlySet<string>,
): AnswerCitationOccurrence[] {
  return markdownBracketOccurrences(text, allowedLabels).filter(({ label }) =>
    allowedLabels.has(label),
  );
}

/** Returns bracket tokens that act as prose citations, excluding Markdown syntax and code. */
export function markdownBracketOccurrences(
  text: string,
  citationLabels: ReadonlySet<string>,
): AnswerCitationOccurrence[] {
  const codeRanges = markdownCodeRanges(text);
  const protectedStarts = markdownProtectedBracketStarts(text, citationLabels);
  return [...text.matchAll(/\[([^\]\n]{1,200})\]/g)]
    .map((match) => ({
      label: match[1].trim(),
      index: match.index ?? 0,
      length: match[0].length,
    }))
    .filter(
      ({ index, length }) =>
        !isMarkdownCodeIndex(index, codeRanges) &&
        !protectedStarts.has(index) &&
        text[index - 1] !== "!" &&
        text[index + length] !== "(",
    );
}

export function replaceMarkdownCitationTokens(
  text: string,
  replacements: ReadonlyMap<string, string>,
): string {
  const occurrences = markdownCitationOccurrences(text, new Set(replacements.keys()));
  if (occurrences.length === 0) return text;
  let result = "";
  let copiedUpTo = 0;
  for (const occurrence of occurrences) {
    result += text.slice(copiedUpTo, occurrence.index);
    result += `[${replacements.get(occurrence.label) ?? occurrence.label}]`;
    copiedUpTo = occurrence.index + occurrence.length;
  }
  return result + text.slice(copiedUpTo);
}

export function analyzeAnswerText(
  text: string,
  allowedLabels: ReadonlySet<string>,
): AnswerTextAnalysis {
  const occurrences = markdownCitationOccurrences(text, allowedLabels);
  const byLabel: Record<string, number> = {};
  for (const { label } of occurrences) byLabel[label] = (byLabel[label] ?? 0) + 1;
  const sentences = sentenceRanges(text);
  let citedSentences = 0;
  let maxLabelsPerSentence = 0;
  for (const [start, end] of sentences) {
    const labels = new Set(
      occurrences.filter(({ index }) => index >= start && index < end).map(({ label }) => label),
    );
    if (labels.size > 0) citedSentences += 1;
    maxLabelsPerSentence = Math.max(maxLabelsPerSentence, labels.size);
  }
  return {
    characters: text.length,
    words: countWords(text),
    sentences: sentences.length,
    occurrences,
    byLabel,
    citedSentences,
    maxLabelsPerSentence,
  };
}

function markdownProtectedBracketStarts(
  text: string,
  allowedLabels: ReadonlySet<string>,
): Set<number> {
  const protectedStarts = new Set<number>();
  const definitions = new Set<string>();
  for (const match of text.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*\S+/gm)) {
    definitions.add(normalizeReferenceId(match[1]));
    protectedStarts.add((match.index ?? 0) + match[0].indexOf("["));
  }
  for (const match of text.matchAll(/!?\[([^\]\n]*)\]\[([^\]\n]*)\]/g)) {
    const firstStart = (match.index ?? 0) + (match[0].startsWith("!") ? 1 : 0);
    const secondStart = text.indexOf("[", firstStart + 1);
    const secondLabel = match[2].trim();
    const referenceId = normalizeReferenceId(match[2] || match[1]);
    if (
      !allowedLabels.has(secondLabel) ||
      definitions.has(referenceId) ||
      match[0].startsWith("!")
    ) {
      protectedStarts.add(firstStart);
      if (secondStart !== -1) protectedStarts.add(secondStart);
    }
  }
  for (const match of text.matchAll(/!?\[([^\]\n]*)\]\([^\n]*\)/g)) {
    protectedStarts.add((match.index ?? 0) + (match[0].startsWith("!") ? 1 : 0));
  }
  for (const match of text.matchAll(/!\[([^\]\n]*)\]/g)) {
    protectedStarts.add((match.index ?? 0) + 1);
  }
  return protectedStarts;
}

function normalizeReferenceId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sentenceRanges(text: string): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  const segmenter = createSegmenter("sentence");
  for (const line of text.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const rawLine = line[0].endsWith("\n") ? line[0].slice(0, -1) : line[0];
    const leadingWhitespace = rawLine.length - rawLine.trimStart().length;
    const trimmed = rawLine.trim();
    if (!trimmed || /^#{1,6}(?:\s|$)/u.test(trimmed)) continue;
    const markerLength = trimmed.match(/^(?:[-*+]|\d+[.)])\s+/u)?.[0].length ?? 0;
    const content = trimmed.slice(markerLength);
    const contentOffset = (line.index ?? 0) + leadingWhitespace + markerLength;
    if (segmenter) {
      for (const segment of segmenter.segment(content)) {
        if (segment.segment.trim()) {
          result.push([
            contentOffset + segment.index,
            contentOffset + segment.index + segment.segment.length,
          ]);
        }
      }
    } else {
      for (const segment of content.matchAll(/.*?(?:[!?]+|\.(?!\d)(?=\s|$)|$)/gu)) {
        if (segment[0].trim()) {
          result.push([
            contentOffset + (segment.index ?? 0),
            contentOffset + (segment.index ?? 0) + segment[0].length,
          ]);
        }
      }
    }
  }
  return result;
}

function countWords(text: string): number {
  const segmenter = createSegmenter("word");
  if (segmenter) {
    return [...segmenter.segment(text)].filter((segment) => segment.isWordLike === true).length;
  }
  return (
    text.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu,
    ) ?? []
  ).length;
}

interface TextSegment {
  segment: string;
  index: number;
  isWordLike?: boolean;
}

interface TextSegmenter {
  segment(input: string): Iterable<TextSegment>;
}

type TextSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: "sentence" | "word" },
) => TextSegmenter;

function createSegmenter(granularity: "sentence" | "word"): TextSegmenter | null {
  const Segmenter = (Intl as unknown as { Segmenter?: TextSegmenterConstructor }).Segmenter;
  return Segmenter ? new Segmenter(undefined, { granularity }) : null;
}
