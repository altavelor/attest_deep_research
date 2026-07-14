import { formatResearchAnswerNote, researchAnswerNotePath } from "@application/use-cases/research";
import { ResearchAnswer } from "@core/answer";
import { SourceReference } from "@core/model";

describe("answer formatter", () => {
  it("formats the final answer with timestamp, question, answer, citations, and follow-ups", () => {
    expect(formatResearchAnswerNote(answer())).toBe(`# Ixplorer Research

**Created:** 2026-05-16T00:00:00.000Z

## Question

How should I use local models?

## Answer

Use local models with citations [1].

## Citations

1. [Research/local.md](Research/local.md)
2. [Example](https://example.com/local)

## Follow-up Questions

1. What should I index next?
`);
  });

  it("turns inline `[url:…]` handles in the answer into clickable links", () => {
    const withUrl: ResearchAnswer = {
      ...answer(),
      answer: "See the source [url:https://example.com/local].",
    };

    expect(formatResearchAnswerNote(withUrl)).toContain(
      "See the source [https://example.com/local](https://example.com/local).",
    );
  });

  it("creates a vault-safe note path from the question and timestamp", () => {
    expect(researchAnswerNotePath(answer())).toBe(
      "Ixplorer/2026-05-16-how-should-i-use-local-models.md",
    );
  });
});

function answer(): ResearchAnswer {
  return {
    question: "How should I use local models?",
    answer: "Use local models with citations [local-1].",
    citations: [
      {
        id: "local-1",
        label: "Research/local.md",
        source: markdownSource("Research/local.md"),
      },
      {
        id: "local-duplicate",
        label: "Research/local.md",
        source: markdownSource("Research/local.md"),
      },
      {
        id: "web-1",
        label: "Example",
        source: webSource("https://example.com/local"),
      },
    ],
    followUpQuestions: ["What should I index next?"],
    createdAt: "2026-05-16T00:00:00.000Z",
  };
}

function markdownSource(path: string): SourceReference {
  return {
    id: `source-${path}`,
    kind: "markdown",
    title: path,
    path,
    headingPath: [],
  };
}

function webSource(url: string): SourceReference {
  return {
    id: `source-${url}`,
    kind: "web",
    title: "Example",
    url,
    snippet: "Snippet",
    retrievedAt: "2026-05-16T00:00:00.000Z",
    wasContentFetched: true,
  };
}
