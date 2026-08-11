export interface CitationDensityOptions {
  maxLabelsPerSentence?: number;
}

interface CitationOccurrence {
  start: number;
  end: number;
  label: string;
  paragraph: number;
  sentence: number;
  removed: boolean;
}

const BRACKET_TOKEN = /\[([^\]\n]{1,200})\]/g;
const PARAGRAPH_BREAK = /\n[ \t]*\n/g;
const SENTENCE_END = /(?:[.!?]+(?=\s|$)|[。！？]+)/g;

export function normalizeCitationDensity(
  text: string,
  citationLabels: ReadonlySet<string>,
  options: CitationDensityOptions = {},
): string {
  if (citationLabels.size === 0) return text;

  const occurrences = citationOccurrences(text, citationLabels);
  if (occurrences.length < 2) return text;

  const remainingByLabel = occurrenceCounts(occurrences);
  collapseCitationGroups(text, occurrences, remainingByLabel);
  capSentenceLabels(
    occurrences,
    remainingByLabel,
    Math.max(1, Math.floor(options.maxLabelsPerSentence ?? 3)),
  );
  collapseAdjacentSentenceRepeats(occurrences, remainingByLabel);

  if (!occurrences.some((occurrence) => occurrence.removed)) return text;
  return removeOccurrences(text, occurrences);
}

export function replaceCitationTokens(
  text: string,
  citationLabels: ReadonlySet<string>,
  replacement: (label: string) => string,
): string {
  const occurrences = citationOccurrences(text, citationLabels);
  if (occurrences.length === 0) return text;

  let result = "";
  let copiedUpTo = 0;
  for (const occurrence of occurrences) {
    result += text.slice(copiedUpTo, occurrence.start);
    result += replacement(occurrence.label);
    copiedUpTo = occurrence.end;
  }
  return result + text.slice(copiedUpTo);
}

function citationOccurrences(
  text: string,
  citationLabels: ReadonlySet<string>,
): CitationOccurrence[] {
  const paragraphBreaks = [...text.matchAll(PARAGRAPH_BREAK)];
  const protectedMarkdownStarts = protectedMarkdownBracketStarts(text, citationLabels);
  const occurrences: CitationOccurrence[] = [];
  let paragraph = 0;
  let paragraphStart = 0;

  for (const match of text.matchAll(BRACKET_TOKEN)) {
    const start = match.index;
    if (start === undefined) continue;
    const label = match[1].trim();
    if (
      !citationLabels.has(label) ||
      protectedMarkdownStarts.has(start) ||
      isInlineMarkdownLink(text, start + match[0].length)
    )
      continue;

    while (
      paragraph < paragraphBreaks.length &&
      (paragraphBreaks[paragraph].index ?? 0) + paragraphBreaks[paragraph][0].length <= start
    ) {
      const boundary = paragraphBreaks[paragraph];
      paragraphStart = (boundary.index ?? 0) + boundary[0].length;
      paragraph += 1;
    }

    occurrences.push({
      start,
      end: start + match[0].length,
      label,
      paragraph,
      sentence: sentenceNumber(text.slice(paragraphStart, start)),
      removed: false,
    });
  }

  return occurrences;
}

function isInlineMarkdownLink(text: string, tokenEnd: number): boolean {
  return text[tokenEnd] === "(";
}

function protectedMarkdownBracketStarts(
  text: string,
  citationLabels: ReadonlySet<string>,
): Set<number> {
  const protectedStarts = new Set<number>();
  const definitions = new Set<string>();
  for (const match of text.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*\S+/gm)) {
    definitions.add(normalizeReferenceId(match[1]));
    protectedStarts.add((match.index ?? 0) + match[0].indexOf("["));
  }

  for (const match of text.matchAll(/!?\[([^\]\n]*)\]\[([^\]\n]*)\]/g)) {
    const referenceId = normalizeReferenceId(match[2] || match[1]);
    const firstLabel = match[1].trim();
    const secondLabel = match[2].trim();
    const clearlyReference =
      !citationLabels.has(secondLabel) ||
      (definitions.has(referenceId) && normalizeReferenceId(firstLabel) !== referenceId);
    if (!clearlyReference) continue;
    const firstStart = (match.index ?? 0) + (match[0].startsWith("!") ? 1 : 0);
    const secondStart = text.indexOf("[", firstStart + 1);
    protectedStarts.add(firstStart);
    if (secondStart !== -1) protectedStarts.add(secondStart);
  }
  return protectedStarts;
}

function normalizeReferenceId(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sentenceNumber(prefix: string): number {
  return [...prefix.matchAll(SENTENCE_END)].length;
}

function occurrenceCounts(occurrences: readonly CitationOccurrence[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) {
    counts.set(occurrence.label, (counts.get(occurrence.label) ?? 0) + 1);
  }
  return counts;
}

function collapseCitationGroups(
  text: string,
  occurrences: CitationOccurrence[],
  remainingByLabel: Map<string, number>,
): void {
  let previous: CitationOccurrence | undefined;
  for (const occurrence of occurrences) {
    if (
      previous &&
      previous.label === occurrence.label &&
      previous.paragraph === occurrence.paragraph &&
      previous.sentence === occurrence.sentence &&
      /^[ \t]*$/.test(text.slice(previous.end, occurrence.start))
    ) {
      removeIfAnotherRemains(occurrence, remainingByLabel);
    }
    previous = occurrence;
  }
}

function collapseAdjacentSentenceRepeats(
  occurrences: CitationOccurrence[],
  remainingByLabel: Map<string, number>,
): void {
  const lastSentenceByLabel = new Map<string, { paragraph: number; sentence: number }>();
  for (const occurrence of occurrences) {
    if (occurrence.removed) continue;
    const previous = lastSentenceByLabel.get(occurrence.label);
    if (
      previous &&
      previous.paragraph === occurrence.paragraph &&
      previous.sentence + 1 === occurrence.sentence
    ) {
      removeIfAnotherRemains(occurrence, remainingByLabel);
      lastSentenceByLabel.set(occurrence.label, {
        paragraph: occurrence.paragraph,
        sentence: occurrence.sentence,
      });
      continue;
    }
    lastSentenceByLabel.set(occurrence.label, {
      paragraph: occurrence.paragraph,
      sentence: occurrence.sentence,
    });
  }
}

function capSentenceLabels(
  occurrences: CitationOccurrence[],
  remainingByLabel: Map<string, number>,
  maximum: number,
): void {
  const bySentence = new Map<string, CitationOccurrence[]>();
  for (const occurrence of occurrences) {
    if (occurrence.removed) continue;
    const key = `${occurrence.paragraph}:${occurrence.sentence}`;
    const sentenceOccurrences = bySentence.get(key) ?? [];
    sentenceOccurrences.push(occurrence);
    bySentence.set(key, sentenceOccurrences);
  }

  for (const sentenceOccurrences of bySentence.values()) {
    for (const occurrence of sentenceOccurrences.slice(maximum)) {
      removeIfAnotherRemains(occurrence, remainingByLabel);
    }
  }
}

function removeIfAnotherRemains(
  occurrence: CitationOccurrence,
  remainingByLabel: Map<string, number>,
): void {
  const remaining = remainingByLabel.get(occurrence.label) ?? 0;
  if (remaining <= 1) return;
  occurrence.removed = true;
  remainingByLabel.set(occurrence.label, remaining - 1);
}

function removeOccurrences(text: string, occurrences: readonly CitationOccurrence[]): string {
  let result = "";
  let copiedUpTo = 0;
  for (const occurrence of occurrences) {
    result += text.slice(copiedUpTo, occurrence.start);
    if (!occurrence.removed) {
      result += text.slice(occurrence.start, occurrence.end);
    } else if (/^[.,!?;:。！？]/u.test(text.slice(occurrence.end))) {
      result = result.replace(/[ \t]+$/u, "");
    }
    copiedUpTo = occurrence.end;
  }
  return result + text.slice(copiedUpTo);
}
