import { describe, expect, it } from "vitest";

import {
  formatDiagnosticReport,
  retrievalDiagnosticLines,
  webDiagnosticLines,
} from "@apps/obsidian/ui/diagnosticFormatting";
import { ContextDiagnostics } from "@core/diagnostics";

const diagnostics = {
  executionStrategy: "instant",
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
  evidencePlanner: {
    budget: {
      policy: "web-only",
      groups: [
        { name: "explicit", usedTokens: 0, includedItems: 0, droppedItems: 0 },
        { name: "graph", usedTokens: 0, includedItems: 0, droppedItems: 0 },
        { name: "retrieval", usedTokens: 0, includedItems: 0, droppedItems: 0 },
        { name: "web", usedTokens: 8882, includedItems: 8, droppedItems: 0 },
      ],
    },
  },
  web: {
    originalQuestion: "How does anonymous CIA contact work?",
    queryStrategy: "direct",
    queries: ["How does anonymous CIA contact work?"],
    requests: [{ query: "How does anonymous CIA contact work?", limit: 5, maxFetches: 3 }],
    results: [
      {
        chunkId: "web:https://example.com/cia-contact",
        query: "How does anonymous CIA contact work?",
        url: "https://example.com/cia-contact",
        title: "CIA contact",
        providerRank: 1,
        processingRank: 1,
        relevanceScore: 19,
        wasContentFetched: true,
        textSource: "fetched-content",
        textCharacters: 1200,
        estimatedTokens: 300,
        textPreview: "Anonymous messages are accepted through a Tor onion service.",
        status: "included",
        promptOrder: 1,
      },
      {
        chunkId: "web:https://example.com/duplicate",
        query: "How does anonymous CIA contact work?",
        url: "https://example.com/duplicate",
        title: "Duplicate",
        providerRank: 4,
        relevanceScore: 6,
        wasContentFetched: false,
        textSource: "search-snippet",
        textCharacters: 160,
        estimatedTokens: 40,
        textPreview: "Duplicate result snippet.",
        status: "dropped",
        reason: "duplicate-url",
      },
    ],
    finalPrompt: {
      includedChunkIds: ["web:https://example.com/cia-contact"],
      usedTokens: 300,
    },
  },
} as unknown as ContextDiagnostics;

describe("diagnostic formatting", () => {
  it("formats ranked chunks and index state", () => {
    expect(retrievalDiagnosticLines(diagnostics)).toEqual([
      "Index: stale (available, stale)",
      "Query variants: rag query",
      "#1 A.md · a · 0.900 · included",
      "#2 B.md · b · 0.200 · dropped · evidence-planner",
    ]);
  });

  it("returns pure v3 JSON without any text prefix", () => {
    const report = formatDiagnosticReport(diagnostics);

    // Must be valid JSON
    expect(() => JSON.parse(report)).not.toThrow();
    const parsed = JSON.parse(report);
    expect(parsed.schemaVersion).toBe(3);

    // No text prefix — must start with "{"
    expect(report.trimStart()).toMatch(/^\{/);
    expect(report).not.toContain("Diagnostic report");
    expect(report).not.toContain("Context used");
    expect(report).not.toContain("Debug details");
  });

  it("v3 report contains execution strategy in model section", () => {
    const parsed = JSON.parse(formatDiagnosticReport(diagnostics));
    expect(parsed.model.executionStrategy).toBe("instant");
  });

  it("v3 report contains ranked chunks with scores in request section", () => {
    const parsed = JSON.parse(formatDiagnosticReport(diagnostics));
    const ranked = parsed.request.retrieval.rankedChunks;
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBe(0.9);
    expect(ranked[1].score).toBe(0.2);
    expect(ranked[1].status).toBe("dropped");
  });

  it("v3 report has scoreStats for ranked chunks", () => {
    const parsed = JSON.parse(formatDiagnosticReport(diagnostics));
    const stats = parsed.request.retrieval.scoreStats;
    expect(stats).not.toBeNull();
    expect(stats.min).toBeCloseTo(0.2);
    expect(stats.max).toBeCloseTo(0.9);
    expect(typeof stats.avg).toBe("number");
  });

  it("summarizes web evidence in request.web section", () => {
    const parsed = JSON.parse(formatDiagnosticReport(diagnostics));
    expect(parsed.request.web).not.toBeNull();
    expect(parsed.request.web.queryStrategy).toBe("direct");
    expect(parsed.request.web.results).toHaveLength(2);
  });

  it("explains web queries, result processing, and final prompt inclusion", () => {
    expect(webDiagnosticLines(diagnostics)).toEqual([
      "Original question: How does anonymous CIA contact work?",
      "Query strategy: direct",
      "Query construction: use the original question unchanged",
      "Query 1: How does anonymous CIA contact work?",
      "Search request 1: How does anonymous CIA contact work? · limit 5, max fetches 3",
      "Processing: normalize URL → deduplicate → rank → apply web limit → evidence planner → final prompt",
      "Ranking: query-token overlap × 10 + provider-rank bonus",
      "#1 CIA contact · included (prompt #1) · provider rank 1 · relevance 19.000 · fetched-content · 1,200 chars / 300 tokens",
      "  URL: https://example.com/cia-contact",
      "  Query: How does anonymous CIA contact work?",
      "  Preview: Anonymous messages are accepted through a Tor onion service.",
      "#- Duplicate · dropped (duplicate-url) · provider rank 4 · relevance 6.000 · search-snippet · 160 chars / 40 tokens",
      "  URL: https://example.com/duplicate",
      "  Query: How does anonymous CIA contact work?",
      "  Preview: Duplicate result snippet.",
      "Final prompt web section: 1 item(s), 300 evidence-text tokens",
      "Prompt web #1: web:https://example.com/cia-contact",
    ]);
  });
});
