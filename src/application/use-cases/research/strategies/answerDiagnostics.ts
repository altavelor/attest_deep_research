import { AnswerDiagnostics } from "@core/diagnostics";
import { analyzeAnswerText } from "@core/research";

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
  const analysis = analyzeAnswerText(input.answerText, new Set(input.citationLabels));
  const occurrences = analysis.occurrences.length;
  const byLabel = analysis.byLabel;
  return {
    characters: analysis.characters,
    words: analysis.words,
    sentences: analysis.sentences,
    citations: {
      occurrences,
      uniqueLabels: Object.keys(byLabel).length,
      per100Words:
        analysis.words === 0 ? 0 : Number(((occurrences * 100) / analysis.words).toFixed(2)),
      sentenceCoverage:
        analysis.sentences === 0
          ? 0
          : Number(((analysis.citedSentences * 100) / analysis.sentences).toFixed(2)),
      maxLabelsPerSentence: analysis.maxLabelsPerSentence,
      byLabel,
      uncitedPromptSourceIds: input.promptSourceIds.filter((id) => byLabel[id] === undefined),
      collapsedOccurrences: input.collapsedOccurrences,
      verificationRan: input.verificationRan,
      unknownCitationIds: [...input.unknownCitationIds],
      unverifiedCitations: [...input.unverifiedCitations],
    },
  };
}
