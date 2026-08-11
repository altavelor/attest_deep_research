import { AnswerDiagnostics } from "@core/diagnostics";

export function buildAnswerDiagnostics(input: {
  answerText: string;
  promptSourceIds: readonly string[];
  citationLabels: readonly string[];
  collapsedOccurrences: number;
  collapsedByLabel: Readonly<Record<string, number>>;
  verificationRan: boolean;
  unknownCitationIds: readonly string[];
  unverifiedCitations: readonly string[];
  citationOccurrences: readonly { label: string; index: number }[];
}): AnswerDiagnostics {
  const allowedLabels = new Set(input.citationLabels);
  const citations = input.citationOccurrences.filter((citation) =>
    allowedLabels.has(citation.label),
  );
  const countsByLabel = new Map<string, number>();
  for (const citation of citations) {
    countsByLabel.set(citation.label, (countsByLabel.get(citation.label) ?? 0) + 1);
  }
  for (const [label, count] of Object.entries(input.collapsedByLabel)) {
    if (allowedLabels.has(label)) {
      countsByLabel.set(label, (countsByLabel.get(label) ?? 0) + count);
    }
  }
  const sentences = sentenceRanges(input.answerText);
  let citationIndex = 0;
  let citedSentenceCount = 0;
  let maxLabelsPerSentence = 0;
  for (const [start, end] of sentences) {
    while (citationIndex < citations.length && citations[citationIndex].index < start) {
      citationIndex += 1;
    }
    const labels = new Set<string>();
    while (citationIndex < citations.length && citations[citationIndex].index < end) {
      labels.add(citations[citationIndex].label);
      citationIndex += 1;
    }
    if (labels.size > 0) citedSentenceCount += 1;
    maxLabelsPerSentence = Math.max(maxLabelsPerSentence, labels.size);
  }
  const words = countWords(input.answerText);
  const occurrences = [...countsByLabel.values()].reduce((total, count) => total + count, 0);
  const byLabel = Object.fromEntries(countsByLabel);
  return {
    characters: input.answerText.length,
    words,
    sentences: sentences.length,
    citations: {
      occurrences,
      uniqueLabels: countsByLabel.size,
      per100Words: words === 0 ? 0 : Number(((occurrences * 100) / words).toFixed(2)),
      sentenceCoverage:
        sentences.length === 0
          ? 0
          : Number(((citedSentenceCount * 100) / sentences.length).toFixed(2)),
      maxLabelsPerSentence,
      byLabel,
      uncitedPromptSourceIds: input.promptSourceIds.filter((id) => !countsByLabel.has(id)),
      collapsedOccurrences: input.collapsedOccurrences,
      verificationRan: input.verificationRan,
      unknownCitationIds: [...input.unknownCitationIds],
      unverifiedCitations: [...input.unverifiedCitations],
    },
  };
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
      continue;
    }
    for (const segment of content.matchAll(/.*?(?:[!?]+|\.(?!\d)(?=\s|$)|$)/gu)) {
      if (segment[0].trim()) {
        result.push([
          contentOffset + (segment.index ?? 0),
          contentOffset + (segment.index ?? 0) + segment[0].length,
        ]);
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
