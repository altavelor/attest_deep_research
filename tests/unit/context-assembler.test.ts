import { describe, expect, it } from "vitest";

import { MarkdownExtractor } from "../../src/extractors/MarkdownExtractor";
import { ContextAssembler } from "../../src/research/ContextAssembler";
import { RetrievedChunk } from "../../src/shared/types";

describe("ContextAssembler", () => {
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
    expect(result.diagnostics.explicitSources.filter((source) => source.status === "dropped"))
      .toHaveLength(1);
  });
});

function createAssembler(files: Record<string, string>): ContextAssembler {
  const availablePaths = Object.keys(files);

  return new ContextAssembler({
    extractors: [new MarkdownExtractor({ maxChunkLength: 400, chunkOverlap: 80 })],
    files: {
      listPaths: async () => availablePaths,
      readFile: async (path) => files[path] ?? "",
      getModifiedTime: async () => 1,
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
