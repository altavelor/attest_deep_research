import { describe, expect, it } from "vitest";
import {
  createConversationSourceRegistry,
  bindAnswerToConversationRegistry,
  recordConversationCitationUsages,
  registerConversationEvidence,
  selectConversationRegistryPromptView,
} from "@core/chat/sourceRegistry";
import type { RetrievedChunk } from "@core/model";
import type { ContextDiagnostics } from "@core/diagnostics";
import { buildResearchPrompt, buildThinkingResearchMessages } from "@core/research";
import { buildAnswerDiagnostics } from "@application/use-cases/research/strategies/answerDiagnostics";

function webChunk(
  id: string,
  text: string,
  contentHash = text,
  url = "https://www.example.com/recipe#step",
): RetrievedChunk {
  return {
    id,
    text,
    contentHash,
    score: 1,
    source: {
      id,
      kind: "web",
      title: "Recipe",
      url,
      snippet: "",
      retrievedAt: "2026-08-21T00:00:00.000Z",
      wasContentFetched: true,
    },
  };
}

function pdfChunk(id: string, text: string, pageNumber: number): RetrievedChunk {
  return {
    id,
    text,
    contentHash: "handbook",
    score: 1,
    source: {
      id,
      kind: "pdf",
      title: "Handbook",
      path: "Library/handbook.pdf",
      pageNumber,
    },
  };
}

describe("conversation source registry", () => {
  it("creates an immutable replacement revision when a source's captured content changes", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:first", "Original ingredients", "v1")],
      "2026-08-21T00:00:00.000Z",
    );
    const second = registerConversationEvidence(
      first.registry,
      [webChunk("web:second", "Updated ingredients", "v2")],
      "2026-08-22T00:00:00.000Z",
    );

    expect(second.registry.sources).toHaveLength(1);
    expect(second.registry.sources[0].revisions).toMatchObject([
      { contentHash: "v1", status: "superseded", chunks: [{ text: "Original ingredients" }] },
      { contentHash: "v2", status: "active", chunks: [{ text: "Updated ingredients" }] },
    ]);
    expect(second.revisionIdByEvidenceId.get("web:second")).toBe(
      second.registry.sources[0].revisions[1].id,
    );
  });

  it("reuses an existing revision instead of rereading or duplicating identical evidence", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:first", "Same text", "same")],
      "2026-08-21T00:00:00.000Z",
    );
    const second = registerConversationEvidence(
      first.registry,
      [webChunk("web:again", "Same text", "same")],
      "2026-08-22T00:00:00.000Z",
    );

    expect(second.registry.sources[0].revisions).toHaveLength(1);
    expect(second.revisionIdByEvidenceId.get("web:again")).toBe(
      first.registry.sources[0].revisions[0].id,
    );
  });

  it("appends a new active revision when content returns to an older hash", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:a1", "Version A", "a")],
      "2026-08-21T00:00:00.000Z",
    );
    const second = registerConversationEvidence(
      first.registry,
      [webChunk("web:b", "Version B", "b")],
      "2026-08-22T00:00:00.000Z",
    );
    const third = registerConversationEvidence(
      second.registry,
      [webChunk("web:a2", "Version A", "a")],
      "2026-08-23T00:00:00.000Z",
    );

    expect(
      third.registry.sources[0].revisions.map(({ contentHash, status }) => ({
        contentHash,
        status,
      })),
    ).toEqual([
      { contentHash: "a", status: "superseded" },
      { contentHash: "b", status: "superseded" },
      { contentHash: "a", status: "active" },
    ]);
  });

  it("reuses a superseded stored revision without changing the registry", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:a", "Version A", "a")],
      "2026-08-21T00:00:00.000Z",
    );
    const second = registerConversationEvidence(
      first.registry,
      [webChunk("web:b", "Version B", "b")],
      "2026-08-22T00:00:00.000Z",
    );
    const storedRevision = webChunk("source-1:revision-1", "Version A", "a");

    const reused = registerConversationEvidence(
      second.registry,
      [storedRevision],
      "2026-08-23T00:00:00.000Z",
    );

    expect(reused.registry).toEqual(second.registry);
    expect(reused.revisionIdByEvidenceId.get(storedRevision.id)).toBe("source-1:revision-1");
  });

  it("keeps stored revisions separate from fresh chunks for the same source", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:a", "Version A", "a")],
      "2026-08-21T00:00:00.000Z",
    );
    const second = registerConversationEvidence(
      first.registry,
      [webChunk("web:b", "Version B", "b")],
      "2026-08-22T00:00:00.000Z",
    );
    const storedRevision = webChunk("source-1:revision-1", "Version A", "a");

    const mixed = registerConversationEvidence(
      second.registry,
      [storedRevision, webChunk("web:c", "Version C", "c")],
      "2026-08-23T00:00:00.000Z",
    );

    expect(
      mixed.registry.sources[0].revisions.map(({ contentHash, status }) => ({
        contentHash,
        status,
      })),
    ).toEqual([
      { contentHash: "a", status: "superseded" },
      { contentHash: "b", status: "superseded" },
      { contentHash: "c", status: "active" },
    ]);
    expect(mixed.revisionIdByEvidenceId.get(storedRevision.id)).toBe("source-1:revision-1");
    expect(mixed.revisionIdByEvidenceId.get("web:c")).toBe("source-1:revision-3");
  });

  it("keeps the complete catalog while adding only relevant stored evidence to the prompt view", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [
        webChunk("web:recipe", "Ingredients include cottage cheese and eggs", "recipe"),
        webChunk(
          "web:weather",
          "Heavy rain is expected tomorrow",
          "weather",
          "https://example.com/weather",
        ),
      ],
      "2026-08-21T00:00:00.000Z",
    );

    const view = selectConversationRegistryPromptView(
      registered.registry,
      "How many eggs for syrniki?",
    );

    expect(view.catalog).toHaveLength(2);
    expect(view.relevantEvidence).toHaveLength(1);
    expect(view.relevantEvidence[0].text).toContain("eggs");
  });

  it("keeps the matching chunk of a revision when the evidence budget is bounded", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [
        webChunk("web:lead", "a".repeat(400), "recipe-v1", "https://example.com/recipe"),
        webChunk(
          "web:match",
          "Syrniki need four eggs per kilogram of curd.",
          "recipe-v1",
          "https://example.com/recipe",
        ),
      ],
      "2026-08-21T00:00:00.000Z",
    );

    const view = selectConversationRegistryPromptView(
      registered.registry,
      "How many eggs for syrniki?",
      6,
      200,
    );

    expect(view.relevantEvidence).toHaveLength(1);
    expect(view.relevantEvidence[0].text).toContain("eggs");
  });

  it("bounds the catalog separately while retaining an explicitly requested revision", () => {
    let registry = createConversationSourceRegistry();
    for (let index = 1; index <= 12; index += 1) {
      registry = registerConversationEvidence(
        registry,
        [
          webChunk(
            `web:${index}`,
            `Evidence ${index} ${"long topic ".repeat(20)}`,
            `hash-${index}`,
            `https://example.com/source-${index}`,
          ),
        ],
        `2026-08-${String(index).padStart(2, "0")}T00:00:00.000Z`,
      ).registry;
      registry.sources.at(-1)!.title = `Very long source title ${index} ${"title ".repeat(20)}`;
    }

    const explicitRevisionId = registry.sources.at(-1)!.revisions[0].id;
    const view = selectConversationRegistryPromptView(
      registry,
      `Use ${explicitRevisionId}`,
      1,
      100,
      320,
    );

    expect(view.catalogText.length).toBeLessThanOrEqual(320);
    expect(view.catalogText).toContain(explicitRevisionId);
    expect(view.relevantEvidence.map((chunk) => chunk.id)).toEqual([explicitRevisionId]);
    expect(view.catalog.length).toBeLessThan(registry.sources.length);

    const instantPrompt = buildResearchPrompt({
      question: `Use ${explicitRevisionId}`,
      evidence: [],
      conversationRegistry: view,
      maxEvidenceItems: 1,
    });
    const thinkingSystemPrompt = buildThinkingResearchMessages({
      question: `Use ${explicitRevisionId}`,
      requiredTools: [],
      conversationRegistry: view,
      toolContext: { coreVariant: "research", availableTools: [] },
    })[0].content;
    expect(instantPrompt).toContain(`Conversation source registry:\n${view.catalogText}`);
    expect(thinkingSystemPrompt).toContain(view.catalogText);
  });

  it("prioritizes an exact revision id over the containing source id and its active revision", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:old", "Old evidence", "old")],
      "2026-08-20T00:00:00.000Z",
    );
    const second = registerConversationEvidence(
      first.registry,
      [webChunk("web:new", "New evidence", "new")],
      "2026-08-21T00:00:00.000Z",
    );

    const view = selectConversationRegistryPromptView(
      second.registry,
      "Use source-1:revision-1",
      1,
    );

    expect(view.relevantEvidence.map((chunk) => chunk.id)).toEqual(["source-1:revision-1"]);
  });

  it("records citation offsets against the immutable revision used by an answer", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:one", "Stored evidence")],
      "2026-08-21T00:00:00.000Z",
    );
    const registry = recordConversationCitationUsages(
      registered.registry,
      "message-1",
      "Claim [web:one].",
      registered.revisionIdByEvidenceId,
    );

    expect(registry.sources[0].revisions[0].usages).toEqual([
      { messageId: "message-1", citationOffsets: [6] },
    ]);
  });

  it("binds the canonical answer, citations, evidence, and diagnostics to revision ids", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:one", "Stored evidence")],
      "2026-08-21T00:00:00.000Z",
    );
    const answer = bindAnswerToConversationRegistry(
      {
        question: "Q",
        answer: "Claim [web:one].",
        citations: [
          {
            id: "web:one",
            label: "Recipe",
            source: webChunk("web:one", "Stored evidence").source,
          },
        ],
        evidence: [webChunk("web:one", "Stored evidence")],
        followUpQuestions: [],
        createdAt: "2026-08-21T00:00:00.000Z",
      },
      registered.registry,
      registered.revisionIdByEvidenceId,
    );

    expect(answer.answer).toBe("Claim [source-1:revision-1].");
    expect(answer.citations.map((citation) => citation.id)).toEqual(["source-1:revision-1"]);
    expect(answer.evidence?.map((chunk) => chunk.id)).toEqual(["source-1:revision-1"]);
  });

  it("extends the active revision when a later turn retrieves a different chunk subset", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      [pdfChunk("pdf:page-1", "Introduction", 1), pdfChunk("pdf:page-7", "Cited rule", 7)],
      "2026-08-21T00:00:00.000Z",
    );
    const second = registerConversationEvidence(
      first.registry,
      [pdfChunk("pdf:page-1", "Introduction", 1), pdfChunk("pdf:page-9", "Appendix", 9)],
      "2026-08-22T00:00:00.000Z",
    );

    const source = second.registry.sources[0];
    expect(source.revisions).toHaveLength(1);
    expect(source.revisions[0].status).toBe("active");
    expect(source.revisions[0].chunks.map((chunk) => chunk.id)).toEqual([
      "pdf:page-1",
      "pdf:page-7",
      "pdf:page-9",
    ]);
    expect(second.revisionIdByEvidenceId.get("pdf:page-9")).toBe("source-1:revision-1");
  });

  it("still supersedes the active revision when a shared chunk's content changed", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      [pdfChunk("pdf:page-1", "Original", 1)],
      "2026-08-21T00:00:00.000Z",
    );
    const changed = { ...pdfChunk("pdf:page-1", "Rewritten", 1), contentHash: "handbook-v2" };
    const second = registerConversationEvidence(
      first.registry,
      [changed],
      "2026-08-22T00:00:00.000Z",
    );

    const source = second.registry.sources[0];
    expect(source.revisions.map((revision) => revision.status)).toEqual(["superseded", "active"]);
    expect(second.revisionIdByEvidenceId.get("pdf:page-1")).toBe("source-1:revision-2");
  });

  it("replaces the usage of a message that is recorded twice", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:one", "Stored evidence")],
      "2026-08-21T00:00:00.000Z",
    );
    const once = recordConversationCitationUsages(
      registered.registry,
      "message-1",
      "Claim [source-1:revision-1].",
    );
    const twice = recordConversationCitationUsages(
      once,
      "message-1",
      "Claim [source-1:revision-1]. Again [source-1:revision-1].",
    );

    expect(twice.sources[0].revisions[0].usages).toEqual([
      { messageId: "message-1", citationOffsets: [6, 35] },
    ]);
  });

  it("keeps the cited chunk's page in the bound evidence of a multi-chunk revision", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [pdfChunk("pdf:page-1", "Introduction", 1), pdfChunk("pdf:page-7", "Cited rule", 7)],
      "2026-08-21T00:00:00.000Z",
    );
    const answer = bindAnswerToConversationRegistry(
      {
        question: "Q",
        answer: "Claim [pdf:page-7].",
        citations: [
          {
            id: "pdf:page-7",
            label: "Handbook",
            source: pdfChunk("pdf:page-7", "Cited rule", 7).source,
          },
        ],
        evidence: [pdfChunk("pdf:page-7", "Cited rule", 7)],
        followUpQuestions: [],
        createdAt: "2026-08-21T00:00:00.000Z",
      },
      registered.registry,
      registered.revisionIdByEvidenceId,
    );

    const boundSource = answer.evidence?.[0].source;
    expect(boundSource).toMatchObject({ kind: "pdf", pageNumber: 7 });
    expect(answer.citations[0].source).toMatchObject({ kind: "pdf", pageNumber: 7 });
  });

  it("keeps the full text of every bound evidence revision", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [
        webChunk("web:one", "First source text", "hash-1", "https://www.example.com/one"),
        webChunk("web:two", "Second source text", "hash-2", "https://www.example.com/two"),
        webChunk("web:three", "Third source text", "hash-3", "https://www.example.com/three"),
      ],
      "2026-08-21T00:00:00.000Z",
    );
    const answer = bindAnswerToConversationRegistry(
      {
        question: "Q",
        answer: "A [web:one]. B [web:two]. C [web:three].",
        citations: [],
        evidence: [],
        followUpQuestions: [],
        createdAt: "2026-08-21T00:00:00.000Z",
      },
      registered.registry,
      registered.revisionIdByEvidenceId,
    );

    expect(answer.evidence?.map((chunk) => chunk.text)).toEqual([
      "First source text",
      "Second source text",
      "Third source text",
    ]);
  });

  it("collapses multiple cited chunks that bind to one source revision", () => {
    const first = webChunk("web:first", "First part", "part-1");
    const second = webChunk("web:second", "Second part", "part-2");
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [first, second],
      "2026-08-21T00:00:00.000Z",
    );
    const answer = bindAnswerToConversationRegistry(
      {
        question: "Q",
        answer: "Claim [web:first][web:second].",
        citations: [
          { id: first.id, label: "First", source: first.source },
          { id: second.id, label: "Second", source: second.source },
        ],
        evidence: [first, second],
        contextDiagnostics: {
          answer: {
            characters: 30,
            words: 3,
            sentences: 1,
            citations: {
              occurrences: 2,
              uniqueLabels: 2,
              per100Words: 66.67,
              sentenceCoverage: 100,
              maxLabelsPerSentence: 2,
              byLabel: { "web:first": 1, "web:second": 1 },
              uncitedPromptSourceIds: [],
              collapsedOccurrences: 0,
              verificationRan: true,
              unknownCitationIds: [],
              unverifiedCitations: ["web:first", "web:second", "source-9:revision-2"],
            },
          },
        } as unknown as ContextDiagnostics,
        followUpQuestions: [],
        createdAt: "2026-08-21T00:00:00.000Z",
      },
      registered.registry,
      registered.revisionIdByEvidenceId,
    );

    expect(answer.answer).toBe("Claim [source-1:revision-1].");
    expect(answer.citations).toHaveLength(1);
    expect(answer.contextDiagnostics?.answer).toMatchObject({
      characters: 28,
      words: 5,
      sentences: 1,
      citations: {
        occurrences: 1,
        uniqueLabels: 1,
        per100Words: 20,
        sentenceCoverage: 100,
        maxLabelsPerSentence: 1,
        byLabel: { "source-1:revision-1": 1 },
        uncitedPromptSourceIds: [],
        collapsedOccurrences: 1,
        unverifiedCitations: ["source-1:revision-1", "source-9:revision-2"],
      },
    });
  });

  it("preserves diagnostics for a previously registered revision when no fresh mapping exists", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:one", "Stored evidence")],
      "2026-08-21T00:00:00.000Z",
    );
    const revisionId = "source-1:revision-1";
    const diagnostics = buildAnswerDiagnostics({
      answerText: `Stored claim [${revisionId}].`,
      promptSourceIds: [revisionId],
      citationLabels: [revisionId],
      collapsedOccurrences: 0,
      collapsedByLabel: {},
      verificationRan: true,
      unknownCitationIds: [],
      unverifiedCitations: [],
      citationOccurrences: [],
    });

    const answer = bindAnswerToConversationRegistry(
      {
        question: "Q",
        answer: `Stored claim [${revisionId}].`,
        citations: [
          {
            id: revisionId,
            label: "Recipe",
            source: { ...webChunk("web:one", "Stored evidence").source, id: revisionId },
          },
        ],
        evidence: [],
        contextDiagnostics: { answer: diagnostics } as unknown as ContextDiagnostics,
        followUpQuestions: [],
        createdAt: "2026-08-22T00:00:00.000Z",
      },
      registered.registry,
      new Map(),
    );

    expect(answer.contextDiagnostics?.answer?.citations).toMatchObject({
      occurrences: 1,
      byLabel: { [revisionId]: 1 },
      uncitedPromptSourceIds: [],
    });
  });

  it("does not bind, record, or count citation-shaped Markdown code and media", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:one", "Stored evidence")],
      "2026-08-21T00:00:00.000Z",
    );
    const text =
      "Example `[web:one]`.\n\n```text\n[web:one]\n```\n\n![web:one](image.png) [web:one](https://example.com)\n\nClaim [web:one].";
    const bound = bindAnswerToConversationRegistry(
      {
        question: "Q",
        answer: text,
        citations: [
          { id: "web:one", label: "Recipe", source: webChunk("web:one", "Stored").source },
        ],
        evidence: [webChunk("web:one", "Stored evidence")],
        contextDiagnostics: {
          answer: buildAnswerDiagnostics({
            answerText: text,
            promptSourceIds: ["web:one"],
            citationLabels: ["web:one"],
            collapsedOccurrences: 0,
            collapsedByLabel: {},
            verificationRan: true,
            unknownCitationIds: [],
            unverifiedCitations: [],
            citationOccurrences: [],
          }),
        } as unknown as ContextDiagnostics,
        followUpQuestions: [],
        createdAt: "2026-08-21T00:00:00.000Z",
      },
      registered.registry,
      registered.revisionIdByEvidenceId,
    );
    const used = recordConversationCitationUsages(registered.registry, "message-1", bound.answer);

    expect(bound.answer).toContain("`[web:one]`");
    expect(bound.answer).toContain("```text\n[web:one]\n```");
    expect(bound.answer).toContain("![web:one](image.png)");
    expect(bound.answer).toContain("[web:one](https://example.com)");
    expect(bound.answer).toContain("Claim [source-1:revision-1].");
    expect(bound.contextDiagnostics?.answer?.citations.occurrences).toBe(1);
    expect(used.sources[0].revisions[0].usages[0].citationOffsets).toEqual([
      bound.answer.lastIndexOf("[source-1:revision-1]"),
    ]);
  });

  it.each(["```", "~~~"])(
    "does not bind, record, or count citations in an unclosed %s fence",
    (fence) => {
      const registered = registerConversationEvidence(
        createConversationSourceRegistry(),
        [webChunk("web:one", "Stored evidence")],
        "2026-08-21T00:00:00.000Z",
      );
      const text = `Example before.\n\n${fence}text\n[web:one]\nStill code`;
      const bound = bindAnswerToConversationRegistry(
        {
          question: "Q",
          answer: text,
          citations: [
            { id: "web:one", label: "Recipe", source: webChunk("web:one", "Stored").source },
          ],
          evidence: [webChunk("web:one", "Stored evidence")],
          contextDiagnostics: {
            answer: buildAnswerDiagnostics({
              answerText: text,
              promptSourceIds: ["web:one"],
              citationLabels: ["web:one"],
              collapsedOccurrences: 0,
              collapsedByLabel: {},
              verificationRan: true,
              unknownCitationIds: [],
              unverifiedCitations: [],
              citationOccurrences: [],
            }),
          } as unknown as ContextDiagnostics,
          followUpQuestions: [],
          createdAt: "2026-08-21T00:00:00.000Z",
        },
        registered.registry,
        registered.revisionIdByEvidenceId,
      );
      const used = recordConversationCitationUsages(registered.registry, "message-1", bound.answer);

      expect(bound.answer).toBe(text);
      expect(bound.citations).toEqual([]);
      expect(bound.contextDiagnostics?.answer?.citations).toMatchObject({
        occurrences: 0,
        byLabel: {},
      });
      expect(used.sources[0].revisions[0].usages).toEqual([]);
    },
  );

  it("uses the canonical Intl-aware analyzer after binding CJK answers", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:one", "证据")],
      "2026-08-21T00:00:00.000Z",
    );
    const initialText = "这是一个中文答案。[web:one]";
    const bound = bindAnswerToConversationRegistry(
      {
        question: "Q",
        answer: initialText,
        citations: [{ id: "web:one", label: "Recipe", source: webChunk("web:one", "证据").source }],
        evidence: [webChunk("web:one", "证据")],
        contextDiagnostics: {
          answer: buildAnswerDiagnostics({
            answerText: initialText,
            promptSourceIds: ["web:one"],
            citationLabels: ["web:one"],
            collapsedOccurrences: 0,
            collapsedByLabel: {},
            verificationRan: true,
            unknownCitationIds: [],
            unverifiedCitations: [],
            citationOccurrences: [],
          }),
        } as unknown as ContextDiagnostics,
        followUpQuestions: [],
        createdAt: "2026-08-21T00:00:00.000Z",
      },
      registered.registry,
      registered.revisionIdByEvidenceId,
    );
    const expected = buildAnswerDiagnostics({
      answerText: bound.answer,
      promptSourceIds: ["source-1:revision-1"],
      citationLabels: ["source-1:revision-1"],
      collapsedOccurrences: 0,
      collapsedByLabel: {},
      verificationRan: true,
      unknownCitationIds: [],
      unverifiedCitations: [],
      citationOccurrences: [],
    });

    expect(bound.contextDiagnostics?.answer).toMatchObject({
      words: expected.words,
      sentences: expected.sentences,
      citations: {
        occurrences: expected.citations.occurrences,
        per100Words: expected.citations.per100Words,
        sentenceCoverage: expected.citations.sentenceCoverage,
      },
    });
  });

  it("prioritizes an explicit revision id and bounds stored evidence text", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [webChunk("web:long", "A".repeat(200), "long")],
      "2026-08-21T00:00:00.000Z",
    );
    const view = selectConversationRegistryPromptView(
      registered.registry,
      "Use source-1:revision-1",
      6,
      40,
    );

    expect(view.relevantEvidence.map((chunk) => chunk.id)).toEqual(["source-1:revision-1"]);
    expect(view.relevantEvidence[0].text).toHaveLength(40);
  });

  it("distributes a fixed relevance budget across chunks so late evidence remains discoverable", () => {
    const first = webChunk("chunk:first", "a".repeat(20_000), "first");
    const late = webChunk("chunk:late", `late-needle ${"b".repeat(20_000)}`, "late");
    const registry = {
      sources: [
        {
          id: "source-1",
          identity: { kind: "web" as const, canonicalKey: "https://example.com/recipe" },
          title: "Recipe",
          revisions: [
            {
              id: "source-1:revision-1",
              contentHash: "revision",
              capturedAt: "2026-08-21T00:00:00.000Z",
              chunks: [first, late],
              status: "active" as const,
              usages: [],
            },
          ],
        },
      ],
    };

    const view = selectConversationRegistryPromptView(registry, "late-needle", 1, 40, 500);

    expect(view.relevantEvidence.map((chunk) => chunk.id)).toEqual(["source-1:revision-1"]);
    expect(view.relevantEvidence[0].text).toHaveLength(40);
    expect(view.catalogText.length).toBeLessThanOrEqual(500);
  });

  it("finds a late multi-character token with bounded work across thousands of chunks", () => {
    let chunkReads = 0;
    const chunks = new Proxy(
      Array.from({ length: 5_000 }, (_, index) =>
        webChunk(
          `chunk:${index}`,
          index === 4_999 ? `late-needle ${"z".repeat(200)}` : `noise-${index} ${"x".repeat(200)}`,
          `hash-${index}`,
        ),
      ),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/u.test(property)) chunkReads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const registry = {
      sources: [
        {
          id: "source-1",
          identity: { kind: "web" as const, canonicalKey: "https://example.com/archive" },
          title: "Archive",
          revisions: [
            {
              id: "source-1:revision-1",
              contentHash: "revision",
              capturedAt: "2026-08-21T00:00:00.000Z",
              chunks,
              status: "active" as const,
              usages: [],
            },
          ],
        },
      ],
    };

    const view = selectConversationRegistryPromptView(registry, "late-needle", 1, 40, 500);

    expect(view.relevantEvidence.map((chunk) => chunk.id)).toEqual(["source-1:revision-1"]);
    expect(chunkReads).toBeLessThanOrEqual(200);
  });

  it("bounds scoring work and still selects an explicitly mentioned old revision", () => {
    let scoredRevisions = 0;
    const sources = Array.from({ length: 1_000 }, (_, index) => ({
      id: `source-${index + 1}`,
      identity: { kind: "web" as const, canonicalKey: `https://example.com/${index + 1}` },
      title: `Source ${index + 1}`,
      revisions: [
        {
          id: `source-${index + 1}:revision-1`,
          contentHash: `hash-${index + 1}`,
          capturedAt: "2026-08-21T00:00:00.000Z",
          status: "active" as const,
          usages: [],
          chunks: new Proxy([webChunk(`chunk-${index + 1}`, "syrniki need eggs")], {
            get(target, property, receiver) {
              if (typeof property === "string" && /^\d+$/u.test(property)) scoredRevisions += 1;
              return Reflect.get(target, property, receiver);
            },
          }),
        },
      ],
    }));

    const view = selectConversationRegistryPromptView(
      { sources },
      "How many eggs, see source-1:revision-1?",
      3,
    );

    expect(scoredRevisions).toBeLessThanOrEqual(512);
    expect(view.relevantEvidence[0].id).toBe("source-1:revision-1");
  });

  it("uses copy-on-write and retains references for untouched immutable registry branches", () => {
    const first = registerConversationEvidence(
      createConversationSourceRegistry(),
      Array.from({ length: 40 }, (_, index) =>
        webChunk(
          `web:first-${index}`,
          `First evidence ${index} ${"large ".repeat(300)}`,
          `first-${index}`,
          "https://example.com/first",
        ),
      ),
      "2026-08-21T00:00:00.000Z",
    ).registry;
    const untouchedSource = first.sources[0];
    const untouchedRevision = untouchedSource.revisions[0];
    const untouchedChunk = untouchedRevision.chunks[0];

    const registered = registerConversationEvidence(
      first,
      [webChunk("web:second", "Second evidence", "second", "https://example.com/second")],
      "2026-08-22T00:00:00.000Z",
    );

    expect(registered.registry).not.toBe(first);
    expect(registered.registry.sources[0]).toBe(untouchedSource);
    expect(registered.registry.sources[0].revisions[0]).toBe(untouchedRevision);
    expect(registered.registry.sources[0].revisions[0].chunks[0]).toBe(untouchedChunk);
    expect(registered.registry.sources[0].revisions[0].chunks).toBe(untouchedRevision.chunks);
    expect(first.sources).toHaveLength(1);

    const withUsage = recordConversationCitationUsages(
      registered.registry,
      "message-1",
      "Claim [source-2:revision-1].",
    );
    expect(withUsage.sources[0]).toBe(untouchedSource);
    expect(withUsage.sources[1]).not.toBe(registered.registry.sources[1]);
    expect(withUsage.sources[1].revisions[0].chunks).toBe(
      registered.registry.sources[1].revisions[0].chunks,
    );
    expect(registered.registry.sources[1].revisions[0].usages).toEqual([]);
  });
});
