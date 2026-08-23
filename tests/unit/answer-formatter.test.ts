import { formatResearchAnswerNote, researchAnswerNotePath } from "@application/use-cases/research";
import { ResearchAnswer } from "@core/answer";
import { SourceReference } from "@core/model";

describe("answer formatter", () => {
  it("formats the final answer with timestamp, question, answer, citations, and follow-ups", () => {
    expect(formatResearchAnswerNote(answer())).toBe(`# Attest Research

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

  it("numbers web references without evidence after the cited sources", () => {
    const withWebReference: ResearchAnswer = {
      ...answer(),
      answer: "Local says X [local-1] and the web says Y [web-ref-1].",
      webReferences: [{ id: "web-ref-1", url: "https://example.com/unseen" }],
    };

    const note = formatResearchAnswerNote(withWebReference);
    expect(note).toContain("Local says X [1] and the web says Y [3].");
    expect(note).toContain("3. [https://example.com/unseen](https://example.com/unseen)");
  });

  it("numbers the canonical answer without applying a second density pass", () => {
    const repeated: ResearchAnswer = {
      ...answer(),
      answer: "First claim [local-1]. Second claim. Read [guide](https://example.com/guide).",
    };

    expect(formatResearchAnswerNote(repeated)).toContain(
      "First claim [1]. Second claim. Read [guide](https://example.com/guide).",
    );
  });

  it("does not renumber a known citation id used by a Markdown reference link", () => {
    const withReferenceLink: ResearchAnswer = {
      ...answer(),
      answer: [
        "Read [guide][local-1]. Claim [local-duplicate].",
        "",
        "[local-1]: https://example.com/guide",
      ].join("\n"),
    };

    expect(formatResearchAnswerNote(withReferenceLink)).toContain(
      ["Read [guide][local-1]. Claim [1].", "", "[local-1]: https://example.com/guide"].join("\n"),
    );
  });

  it("preserves a Markdown reference link when its text matches its known citation id", () => {
    const withMatchingReferenceLink: ResearchAnswer = {
      ...answer(),
      answer: ["Read [local-1][local-1].", "", "[local-1]: https://example.com/guide"].join("\n"),
    };

    expect(formatResearchAnswerNote(withMatchingReferenceLink)).toContain(
      ["Read [local-1][local-1].", "", "[local-1]: https://example.com/guide"].join("\n"),
    );
  });

  it("creates a vault-safe note path from the question and timestamp", () => {
    expect(researchAnswerNotePath(answer())).toBe(
      "Attest/2026-05-16-how-should-i-use-local-models.md",
    );
  });

  it("keeps different revisions of the same source as separate numbered citations", () => {
    const source = webSource("https://example.com/versioned");
    const versioned: ResearchAnswer = {
      ...answer(),
      answer: "Old claim [source-1:revision-1]. New claim [source-1:revision-2].",
      citations: [
        { id: "source-1:revision-1", label: "Example v1", source },
        { id: "source-1:revision-2", label: "Example v2", source },
        { id: "source-1:revision-2", label: "Duplicate v2", source },
      ],
    };

    const note = formatResearchAnswerNote(versioned);
    expect(note).toContain("Old claim [1]. New claim [2].");
    expect(note.split("https://example.com/versioned").length - 1).toBe(2);
  });
  it("degrades an unsafe web citation label and destination instead of emitting a foreign link", () => {
    const hostile: ResearchAnswer = {
      ...answer(),
      answer: "Claim [web-hostile].",
      citations: [
        {
          id: "web-hostile",
          label: "Report",
          source: {
            ...webSource("https://example.com/report"),
            title: "Report](https://evil.example/phish) cover",
          },
        },
      ],
    };

    const note = formatResearchAnswerNote(hostile);
    expect(note).not.toMatch(/[^\\]\]\(https:\/\/evil/u);
    expect(note).toContain("](https://example.com/report)");
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
