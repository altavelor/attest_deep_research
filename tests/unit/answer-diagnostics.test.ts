import { buildAnswerDiagnostics } from "@application/use-cases/research/strategies/answerDiagnostics";

describe("buildAnswerDiagnostics", () => {
  it("reports an answer without citations", () => {
    const result = buildAnswerDiagnostics({
      answerText: "A short answer.",
      promptSourceIds: ["a"],
      citationLabels: ["a"],
      collapsedOccurrences: 0,
      collapsedByLabel: {},
      verificationRan: true,
      unknownCitationIds: [],
      unverifiedCitations: [],
      citationOccurrences: [],
    });
    expect(result).toMatchObject({
      characters: 15,
      words: 3,
      sentences: 1,
      citations: {
        occurrences: 0,
        uniqueLabels: 0,
        per100Words: 0,
        sentenceCoverage: 0,
        maxLabelsPerSentence: 0,
        uncitedPromptSourceIds: ["a"],
        verificationRan: true,
      },
    });
  });

  it("counts repeated labels and collapsed citations", () => {
    const result = buildAnswerDiagnostics({
      answerText: "One claim [a]. Another claim [a].",
      promptSourceIds: ["a", "b"],
      citationLabels: ["a", "b"],
      collapsedOccurrences: 2,
      collapsedByLabel: { a: 2 },
      verificationRan: true,
      unknownCitationIds: [],
      unverifiedCitations: [],
      citationOccurrences: [
        { label: "a", index: 10 },
        { label: "a", index: 29 },
      ],
    });
    expect(result.citations).toMatchObject({
      occurrences: 4,
      uniqueLabels: 1,
      sentenceCoverage: 100,
      maxLabelsPerSentence: 1,
      byLabel: { a: 4 },
      uncitedPromptSourceIds: ["b"],
      collapsedOccurrences: 2,
    });
  });

  it("counts labels across sentences", () => {
    const result = buildAnswerDiagnostics({
      answerText: "First [a] [b]. Second [c].",
      promptSourceIds: ["a", "b", "c"],
      citationLabels: ["a", "b", "c"],
      collapsedOccurrences: 0,
      collapsedByLabel: {},
      verificationRan: true,
      unknownCitationIds: ["missing"],
      unverifiedCitations: ["a"],
      citationOccurrences: [
        { label: "a", index: 6 },
        { label: "b", index: 10 },
        { label: "c", index: 22 },
      ],
    });
    expect(result.citations).toMatchObject({
      occurrences: 3,
      uniqueLabels: 3,
      sentenceCoverage: 100,
      maxLabelsPerSentence: 2,
      unknownCitationIds: ["missing"],
      unverifiedCitations: ["a"],
    });
  });

  it("treats markdown list items as sentences and keeps decimal numbers intact", () => {
    const answerText = [
      "## Ингредиенты",
      "- 600 г творога [source-1]",
      "- 2 яйца [source-2]",
      "- 50 г муки [source-1]",
      "- щепотка соли [source-3]",
      "",
      "Жарить на среднем огне 0.5 мин с каждой стороны [source-2].",
    ].join("\n");
    const citationOccurrences = [...answerText.matchAll(/\[(source-\d)\]/g)].map((match) => ({
      label: match[1],
      index: match.index,
    }));

    const result = buildAnswerDiagnostics({
      answerText,
      promptSourceIds: ["source-1", "source-2", "source-3"],
      citationLabels: ["source-1", "source-2", "source-3"],
      collapsedOccurrences: 0,
      collapsedByLabel: {},
      verificationRan: true,
      unknownCitationIds: [],
      unverifiedCitations: [],
      citationOccurrences,
    });

    expect(result.sentences).toBe(5);
    expect(result.citations.sentenceCoverage).toBe(100);
    expect(result.citations.maxLabelsPerSentence).toBe(1);
  });

  it("counts words in text that does not use whitespace between words", () => {
    const result = buildAnswerDiagnostics({
      answerText: "这是一个支持中文的答案。",
      promptSourceIds: [],
      citationLabels: [],
      collapsedOccurrences: 0,
      collapsedByLabel: {},
      verificationRan: true,
      unknownCitationIds: [],
      unverifiedCitations: [],
      citationOccurrences: [],
    });

    expect(result.words).toBeGreaterThan(1);
  });
});
