import { describe, expect, it } from "vitest";

import { MarkdownExtractor } from "@adapters/extractors";
import { PdfExtractor, PdfPageTextParser } from "@adapters/extractors";
import { PdfTextCache } from "@adapters/extractors";
import { ContextAssembler } from "../../src/application/use-cases/chat/ContextAssembler";
import { stableId } from "@adapters/extractors";
import { chatHistoryForPrompt, compactChatMessages } from "../../src/application/use-cases/chat/ChatCompaction";
import { GraphContextProvider } from "@core/research";
import { Extractor } from "../../src/application/ports/indexing";
import { RetrievedChunk } from "@core/model";

describe("ContextAssembler", () => {
  it("prioritizes explicit files before the active note", async () => {
    const assembler = createAssembler({
      "Attached.md": "# Attached\n\nExplicit answer.",
      "Active.md": "# Active\n\nActive answer.",
    });

    const result = await assembler.assemble({
      question: "Answer from context",
      contextMode: "include",
      contextPaths: ["Attached.md"],
      activeFilePath: "Active.md",
      includeActiveFile: true,
      evidenceLimit: 1,
    });

    expect(result.explicitEvidence).toHaveLength(1);
    expect(result.explicitEvidence[0].source).toMatchObject({ path: "Attached.md" });
  });

  it("hard-includes selected markdown files in include mode", async () => {
    const assembler = createAssembler({
      "Project.md": "# Project\n\nExplicit context answer.",
    });

    const result = await assembler.assemble({
      question: "What is in Project.md?",
      contextMode: "include",
      contextPaths: ["Project.md"],
      evidenceLimit: 4,
    });

    expect(result.explicitEvidence).toHaveLength(1);
    expect(result.explicitEvidence[0].text).toContain("Explicit context answer.");
    expect(result.retrievalSourcePaths).toBeUndefined();
    expect(result.diagnostics.explicitSources[0]).toMatchObject({
      path: "Project.md",
      role: "attached",
      status: "included",
    });
  });

  it("uses selected files as retrieval filters in filter mode", async () => {
    const assembler = createAssembler({
      "Project.md": "# Project\n\nExplicit context answer.",
    });

    const result = await assembler.assemble({
      question: "What is in Project.md?",
      contextMode: "filter",
      contextPaths: ["Project.md"],
      evidenceLimit: 4,
    });

    expect(result.explicitEvidence).toHaveLength(0);
    expect(result.retrievalSourcePaths).toEqual(["Project.md"]);
    expect(result.diagnostics.explicitSources[0]).toMatchObject({
      path: "Project.md",
      role: "attached",
      status: "filtered",
    });
  });

  it("selects relevant heading chunks for oversized markdown files", async () => {
    const filler = "Filler text. ".repeat(900);
    const assembler = createAssembler({
      "Large.md": `# Intro\n\n${filler}\n\n# Target Section\n\nThe sodium battery answer is here.\n\n# Tail\n\n${filler}`,
    });

    const result = await assembler.assemble({
      question: "Where is the sodium battery answer?",
      contextMode: "include",
      contextPaths: ["Large.md"],
      evidenceLimit: 4,
      smallMarkdownCharLimit: 10_000,
    });

    expect(result.explicitEvidence.length).toBeGreaterThan(0);
    expect(result.explicitEvidence.map((chunk) => chunk.text).join("\n")).toContain(
      "sodium battery answer",
    );
    expect(result.explicitEvidence[0].text.length).toBeLessThan(10_000);
  });

  it("resolves exact @path mentions as explicit context", async () => {
    const assembler = createAssembler({
      "Folder/Mentioned.md": "# Mentioned\n\nMention context answer.",
    });

    const result = await assembler.assemble({
      question: "Use @Folder/Mentioned.md for this answer.",
      contextMode: "filter",
      contextPaths: [],
      evidenceLimit: 4,
    });

    expect(result.explicitEvidence).toHaveLength(1);
    expect(result.explicitEvidence[0].source).toMatchObject({ path: "Folder/Mentioned.md" });
    expect(result.diagnostics.mentionSources[0]).toMatchObject({
      path: "Folder/Mentioned.md",
      status: "included",
    });
  });

  it("includes active file when enabled", async () => {
    const assembler = createAssembler({
      "Active.md": "# Active\n\nActive file answer.",
    });

    const result = await assembler.assemble({
      question: "Use the current note.",
      contextMode: "include",
      contextPaths: [],
      activeFilePath: "Active.md",
      includeActiveFile: true,
      evidenceLimit: 4,
    });

    expect(result.explicitEvidence).toHaveLength(1);
    expect(result.diagnostics.activeSources[0]).toMatchObject({
      path: "Active.md",
      role: "active",
      status: "included",
    });
  });

  it("falls back to evidence limit when context window is unknown", async () => {
    const assembler = createAssembler({
      "A.md": "# A\n\nA answer.",
      "B.md": "# B\n\nB answer.",
      "C.md": "# C\n\nC answer.",
    });

    const result = await assembler.assemble({
      question: "answer",
      contextMode: "include",
      contextPaths: ["A.md", "B.md", "C.md"],
      evidenceLimit: 2,
    });

    expect(result.explicitEvidence).toHaveLength(2);
    expect(
      result.diagnostics.explicitSources.filter((source) => source.status === "dropped"),
    ).toHaveLength(1);
  });

  it("increases available evidence budget after history compaction", async () => {
    const assembler = createAssembler({
      "Evidence.md": `# Evidence\n\n${"Evidence answer. ".repeat(40)}`,
    });
    const longHistory = [
      {
        role: "user" as const,
        content: "Long user context. ".repeat(120),
        createdAt: "2026-06-10T10:00:00.000Z",
      },
      {
        role: "assistant" as const,
        content: "Long assistant context. ".repeat(120),
        createdAt: "2026-06-10T10:00:00.000Z",
      },
      { role: "user" as const, content: "Recent question", createdAt: "2026-06-10T10:00:00.000Z" },
      {
        role: "assistant" as const,
        content: "Recent answer",
        createdAt: "2026-06-10T10:00:00.000Z",
      },
      { role: "user" as const, content: "Newest question", createdAt: "2026-06-10T10:00:00.000Z" },
    ];
    const compacted = compactChatMessages(longHistory, {
      summary: {
        userGoals: ["Understand the evidence"],
        decisions: [],
        unresolvedQuestions: [],
        citedSourcesAlreadyUsed: ["Evidence.md"],
      },
      now: () => new Date("2026-06-10T10:00:00.000Z"),
    }).messages;

    const before = await assembler.assemble({
      question: "What is the evidence answer?",
      contextMode: "include",
      contextPaths: ["Evidence.md"],
      evidenceLimit: 4,
      contextLimitTokens: 1200,
      reservedOutputTokens: 100,
      chatHistory: longHistory.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
    const after = await assembler.assemble({
      question: "What is the evidence answer?",
      contextMode: "include",
      contextPaths: ["Evidence.md"],
      evidenceLimit: 4,
      contextLimitTokens: 1200,
      reservedOutputTokens: 100,
      chatHistory: chatHistoryForPrompt(compacted),
    });

    const beforeHistory = before.diagnostics.budget.groups.find(
      (group) => group.name === "history",
    );
    const afterHistory = after.diagnostics.budget.groups.find((group) => group.name === "history");

    expect(beforeHistory?.usedTokens).toBeGreaterThan(afterHistory?.usedTokens ?? 0);
    expect(before.explicitEvidence).toHaveLength(0);
    expect(after.explicitEvidence.length).toBeGreaterThan(0);
  });

  it("adds include-mode graph candidates as boosted retrieval paths", async () => {
    const assembler = createAssembler(
      {
        "Root.md": "# Root\n\n[[Linked]]",
        "Linked.md": "# Linked\n\nGraph answer.",
      },
      fakeGraphProvider(["Linked.md"]),
    );

    const result = await assembler.assemble({
      question: "What linked context matters?",
      contextMode: "include",
      contextPaths: ["Root.md"],
      evidenceLimit: 4,
      graph: {
        enabled: true,
        includeBacklinks: true,
        expandFilteredContextThroughLinks: false,
        depth: 1,
      },
    });

    expect(result.graphSourcePaths).toEqual(["Linked.md"]);
    expect(result.retrievalSourcePaths).toBeUndefined();
    expect(result.boostedSourcePaths).toEqual(["Linked.md"]);
    expect(result.diagnostics.graph.included[0]).toMatchObject({
      path: "Linked.md",
      status: "included",
    });
  });

  it("keeps filter mode strict unless graph expansion is enabled", async () => {
    const assembler = createAssembler(
      {
        "Root.md": "# Root\n\n[[Linked]]",
        "Linked.md": "# Linked\n\nGraph answer.",
      },
      fakeGraphProvider(["Linked.md"]),
    );

    const strict = await assembler.assemble({
      question: "What linked context matters?",
      contextMode: "filter",
      contextPaths: ["Root.md"],
      evidenceLimit: 4,
      graph: {
        enabled: true,
        includeBacklinks: true,
        expandFilteredContextThroughLinks: false,
        depth: 1,
      },
    });
    const expanded = await assembler.assemble({
      question: "What linked context matters?",
      contextMode: "filter",
      contextPaths: ["Root.md"],
      evidenceLimit: 4,
      graph: {
        enabled: true,
        includeBacklinks: true,
        expandFilteredContextThroughLinks: true,
        depth: 1,
      },
    });

    expect(strict.retrievalSourcePaths).toEqual(["Root.md"]);
    expect(strict.boostedSourcePaths).toBeUndefined();
    expect(expanded.retrievalSourcePaths).toEqual(["Root.md", "Linked.md"]);
  });

  it("reuses cached PDF text for repeated explicit context assembly", async () => {
    let parseCalls = 0;
    const parser: PdfPageTextParser = {
      async *parsePages() {
        parseCalls += 1;
        yield { pageNumber: 1, text: "Explicit PDF answer." };
      },
    };
    const assembler = createAssembler(
      {
        "Spec.pdf": "pdf-bytes",
      },
      undefined,
      [new PdfExtractor({ parser, cache: new PdfTextCache() })],
      { "Spec.pdf": 9 },
    );

    await assembler.assemble({
      question: "What is in the PDF?",
      contextMode: "include",
      contextPaths: ["Spec.pdf"],
      evidenceLimit: 4,
    });
    const second = await assembler.assemble({
      question: "What is in the PDF?",
      contextMode: "include",
      contextPaths: ["Spec.pdf"],
      evidenceLimit: 4,
    });

    expect(parseCalls).toBe(1);
    expect(second.explicitEvidence[0].text).toBe("Explicit PDF answer.");
  });
});

function createAssembler(
  files: Record<string, string>,
  graph?: GraphContextProvider,
  extractors: Extractor[] = [new MarkdownExtractor({ maxChunkLength: 400, chunkOverlap: 80 })],
  sizes: Record<string, number> = {},
): ContextAssembler {
  const availablePaths = Object.keys(files);

  return new ContextAssembler({
    extractors,
    graph,
    generateId: stableId,
    files: {
      listPaths: async () => availablePaths,
      readFile: async (path) => files[path] ?? "",
      getModifiedTime: async () => 1,
      getSize: async (path) => sizes[path] ?? files[path]?.length ?? 0,
    },
    retrieve: async (_query, options) => {
      const sourcePaths = options.sourcePaths ?? [];
      return sourcePaths.map(
        (path, index): RetrievedChunk => ({
          id: `retrieved-${index}`,
          source: {
            id: `retrieved-${index}`,
            kind: "markdown",
            path,
            title: path,
            headingPath: [],
          },
          text: files[path] ?? "",
          contentHash: `hash-${index}`,
          score: 1 - index / 10,
        }),
      );
    },
  });
}

function fakeGraphProvider(paths: string[]): GraphContextProvider {
  return {
    discover: async (request) => ({
      sourcePaths: paths,
      diagnostics: {
        enabled: true,
        source: "metadataCache",
        depth: request.maxDepth,
        rootPaths: request.roots.map((root) => root.path),
        included: paths.map((path) => ({
          path,
          status: "included",
          score: 1,
          edges: [
            {
              from: request.roots[0]?.path ?? "question",
              to: path,
              type: "forward_link",
              depth: 1,
            },
          ],
        })),
        dropped: [],
        unresolved: [],
        limits: request.limits,
      },
    }),
  };
}
