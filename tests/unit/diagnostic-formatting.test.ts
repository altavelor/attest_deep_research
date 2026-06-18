import { describe, expect, it } from "vitest";

import { retrievalDiagnosticLines, skillDiagnosticLines } from "../../src/ui/diagnosticFormatting";
import { ContextDiagnostics } from "../../src/shared/types";

const diagnostics = {
  skills: {
    discoveredCount: 10,
    warnings: [],
    selectedId: "rag-debugger",
    selectedName: "RAG Debugger",
    selectedPath: ".ixplorer/skills/rag-debugger/SKILL.md",
    selectionMode: "manual",
    loadMode: "inline",
    loadStatus: "loaded",
    loadedCharacters: 1200,
    loadedTokens: 300,
    truncated: false,
  },
  retrieval: {
    queryVariants: ["rag query"],
    includedChunkIds: ["a"],
    droppedChunkIds: ["b"],
    filteredSourcePaths: [],
    rankedChunks: [
      { id: "a", path: "A.md", rank: 1, score: 0.9, status: "included" },
      {
        id: "b",
        path: "B.md",
        rank: 2,
        score: 0.2,
        status: "dropped",
        reason: "evidence-planner",
      },
    ],
  },
  index: { status: "stale", available: true, isStale: true },
} as unknown as ContextDiagnostics;

describe("diagnostic formatting", () => {
  it("formats skill selection and load details", () => {
    expect(skillDiagnosticLines(diagnostics)).toEqual([
      "10 skill(s) discovered",
      "Skill: RAG Debugger (manual, inline, loaded)",
      "Skill size: 1,200 chars / 300 tokens",
    ]);
  });

  it("formats ranked chunks and index state", () => {
    expect(retrievalDiagnosticLines(diagnostics)).toEqual([
      "Index: stale (available, stale)",
      "Query variants: rag query",
      "#1 A.md · a · 0.900 · included",
      "#2 B.md · b · 0.200 · dropped · evidence-planner",
    ]);
  });
});
