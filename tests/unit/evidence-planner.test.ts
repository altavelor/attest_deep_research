import { describe, expect, it } from "vitest";

import { EvidencePlanner } from "@core/research";
import { markdownSource, retrieved, webSource } from "../helpers/factories";

describe("EvidencePlanner", () => {
  it("uses a local-first budget by default while keeping at least one web item", () => {
    const planner = new EvidencePlanner();
    const output = planner.plan({
      question: "How does the project work?",
      searchMode: "indexAndWeb",
      evidenceLimit: 5,
      explicitEvidence: [retrieved("explicit-1", markdownSource("A.md"), "Explicit")],
      graphEvidence: [retrieved("graph-1", markdownSource("Graph.md"), "Graph")],
      retrievalEvidence: [
        retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval 1"),
        retrieved("retrieval-2", markdownSource("R2.md"), "Retrieval 2"),
      ],
      webEvidence: [
        retrieved("web-1", webSource("https://example.com/1"), "Web 1"),
        retrieved("web-2", webSource("https://example.com/2"), "Web 2"),
      ],
    });

    expect(output.finalEvidence.map((chunk) => chunk.id)).toEqual([
      "explicit-1",
      "graph-1",
      "retrieval-1",
      "retrieval-2",
      "web-1",
    ]);
    expect(output.webEvidence.map((chunk) => chunk.id)).toEqual(["web-1"]);
    expect(output.diagnostics.budget.policy).toBe("local-first");
  });

  it("raises web priority for freshness questions when web search is enabled", () => {
    const planner = new EvidencePlanner();
    const output = planner.plan({
      question: "What is the latest API changelog?",
      searchMode: "indexAndWeb",
      evidenceLimit: 5,
      explicitEvidence: [retrieved("explicit-1", markdownSource("A.md"), "Explicit")],
      graphEvidence: [retrieved("graph-1", markdownSource("Graph.md"), "Graph")],
      retrievalEvidence: [
        retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval 1"),
        retrieved("retrieval-2", markdownSource("R2.md"), "Retrieval 2"),
      ],
      webEvidence: [
        retrieved("web-1", webSource("https://example.com/1"), "Web 1"),
        retrieved("web-2", webSource("https://example.com/2"), "Web 2"),
      ],
    });

    expect(output.finalEvidence.map((chunk) => chunk.id)).toEqual([
      "explicit-1",
      "web-1",
      "web-2",
      "graph-1",
      "retrieval-1",
    ]);
    expect(output.diagnostics.webIntent).toMatchObject({
      detected: true,
      reason: "freshness-keyword",
      matchedTerms: ["latest", "changelog"],
    });
    expect(output.diagnostics.budget.policy).toBe("freshness");
  });

  it("keeps local-first policy for freshness questions when freshness web boost is disabled", () => {
    const planner = new EvidencePlanner({ useWebWhenFreshnessNeeded: false });
    const output = planner.plan({
      question: "What is the latest API changelog?",
      searchMode: "indexAndWeb",
      evidenceLimit: 5,
      explicitEvidence: [retrieved("explicit-1", markdownSource("A.md"), "Explicit")],
      graphEvidence: [retrieved("graph-1", markdownSource("Graph.md"), "Graph")],
      retrievalEvidence: [
        retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval 1"),
        retrieved("retrieval-2", markdownSource("R2.md"), "Retrieval 2"),
      ],
      webEvidence: [
        retrieved("web-1", webSource("https://example.com/1"), "Web 1"),
        retrieved("web-2", webSource("https://example.com/2"), "Web 2"),
      ],
    });

    expect(output.finalEvidence.map((chunk) => chunk.id)).toEqual([
      "explicit-1",
      "graph-1",
      "retrieval-1",
      "retrieval-2",
      "web-1",
    ]);
    expect(output.diagnostics.webIntent.detected).toBe(false);
    expect(output.diagnostics.budget.policy).toBe("local-first");
  });

  it("lets web fill budget when local evidence is weak", () => {
    const planner = new EvidencePlanner();
    const output = planner.plan({
      question: "How should I configure this?",
      searchMode: "indexAndWeb",
      evidenceLimit: 4,
      explicitEvidence: [],
      graphEvidence: [],
      retrievalEvidence: [retrieved("retrieval-1", markdownSource("R1.md"), "Weak", 0.1)],
      webEvidence: [
        retrieved("web-1", webSource("https://example.com/1"), "Web 1"),
        retrieved("web-2", webSource("https://example.com/2"), "Web 2"),
        retrieved("web-3", webSource("https://example.com/3"), "Web 3"),
      ],
    });

    expect(output.finalEvidence.map((chunk) => chunk.id)).toEqual([
      "retrieval-1",
      "web-1",
      "web-2",
      "web-3",
    ]);
    expect(output.diagnostics.localEvidenceQuality.weak).toBe(true);
    expect(output.diagnostics.budget.policy).toBe("weak-local");
  });

  it("uses only web evidence for web-only mode", () => {
    const planner = new EvidencePlanner();
    const output = planner.plan({
      question: "Search the web",
      searchMode: "webOnly",
      evidenceLimit: 2,
      explicitEvidence: [retrieved("explicit-1", markdownSource("A.md"), "Explicit")],
      graphEvidence: [retrieved("graph-1", markdownSource("Graph.md"), "Graph")],
      retrievalEvidence: [retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval")],
      webEvidence: [
        retrieved("web-1", webSource("https://example.com/1"), "Web 1"),
        retrieved("web-2", webSource("https://example.com/2"), "Web 2"),
        retrieved("web-3", webSource("https://example.com/3"), "Web 3"),
      ],
    });

    expect(output.finalEvidence.map((chunk) => chunk.id)).toEqual(["web-1", "web-2"]);
    expect(output.explicitEvidence).toEqual([]);
    expect(output.retrievedEvidence).toEqual([]);
    expect(output.diagnostics.budget.policy).toBe("web-only");
  });

  it("deduplicates chunks across groups and records dropped ids", () => {
    const planner = new EvidencePlanner();
    const duplicate = retrieved("same", markdownSource("A.md"), "Same");
    const output = planner.plan({
      question: "Explain",
      searchMode: "indexOnly",
      evidenceLimit: 2,
      explicitEvidence: [duplicate],
      graphEvidence: [duplicate],
      retrievalEvidence: [
        retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval 1"),
        retrieved("retrieval-2", markdownSource("R2.md"), "Retrieval 2"),
      ],
      webEvidence: [retrieved("web-1", webSource("https://example.com/1"), "Web 1")],
    });

    expect(output.finalEvidence.map((chunk) => chunk.id)).toEqual(["same", "retrieval-1"]);
    expect(output.graphEvidence).toEqual([]);
    expect(output.diagnostics.dropped.retrievalChunkIds).toEqual(["retrieval-2"]);
    expect(output.diagnostics.dropped.webChunkIds).toEqual(["web-1"]);
  });
});

describe("EvidencePlanner.requiresWebEvidence", () => {
  const strongLocal = {
    explicitEvidence: [retrieved("explicit-1", markdownSource("A.md"), "Explicit")],
    graphEvidence: [retrieved("graph-1", markdownSource("Graph.md"), "Graph")],
    retrievalEvidence: [
      retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval 1"),
      retrieved("retrieval-2", markdownSource("R2.md"), "Retrieval 2"),
      retrieved("retrieval-3", markdownSource("R3.md"), "Retrieval 3"),
    ],
  };

  it("does not require web evidence for a local-first plan", () => {
    expect(
      new EvidencePlanner().requiresWebEvidence({
        question: "Explain sorting",
        searchMode: "indexAndWeb",
        ...strongLocal,
      }),
    ).toBe(false);
  });

  it("requires web evidence when the question signals freshness", () => {
    expect(
      new EvidencePlanner().requiresWebEvidence({
        question: "What is the latest pricing?",
        searchMode: "indexAndWeb",
        ...strongLocal,
      }),
    ).toBe(true);
  });

  it("requires web evidence when local evidence is weak", () => {
    expect(
      new EvidencePlanner().requiresWebEvidence({
        question: "Explain sorting",
        searchMode: "indexAndWeb",
        explicitEvidence: [],
        graphEvidence: [],
        retrievalEvidence: [],
      }),
    ).toBe(true);
  });

  it("does not flag retrieval quality from reciprocal-rank scores", () => {
    const planner = new EvidencePlanner();
    const rrfScored = [
      retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval 1", 0.0295),
      retrieved("retrieval-2", markdownSource("R2.md"), "Retrieval 2", 0.0164),
      retrieved("retrieval-3", markdownSource("R3.md"), "Retrieval 3", 0.0161),
    ];
    const output = planner.plan({
      question: "How does the project work?",
      searchMode: "indexAndWeb",
      evidenceLimit: 5,
      explicitEvidence: [retrieved("explicit-1", markdownSource("A.md"), "Explicit")],
      graphEvidence: [retrieved("graph-1", markdownSource("Graph.md"), "Graph")],
      retrievalEvidence: rrfScored,
      webEvidence: [],
    });

    const { localEvidenceQuality } = output.diagnostics;
    expect(localEvidenceQuality.reasons).toEqual([]);
    expect(localEvidenceQuality.averageRetrievalScore).toBeCloseTo(0.0207, 4);
  });

  it("still detects weak local evidence structurally, whatever the score scale", () => {
    const planner = new EvidencePlanner();
    const output = planner.plan({
      question: "How does the project work?",
      searchMode: "indexAndWeb",
      evidenceLimit: 5,
      explicitEvidence: [],
      graphEvidence: [],
      retrievalEvidence: [retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval 1", 0.9)],
      webEvidence: [],
    });

    const { localEvidenceQuality } = output.diagnostics;
    expect(localEvidenceQuality.weak).toBe(true);
    expect(localEvidenceQuality.reasons).toEqual([
      "no-explicit-evidence",
      "no-graph-evidence",
      "few-retrieval-chunks",
    ]);
  });

  it("detects weak local evidence even when fused scores are high", () => {
    const planner = new EvidencePlanner();
    const output = planner.plan({
      question: "How does the project work?",
      searchMode: "indexAndWeb",
      evidenceLimit: 5,
      explicitEvidence: [],
      graphEvidence: [],
      retrievalEvidence: [
        retrieved("retrieval-1", markdownSource("R1.md"), "Retrieval 1", 0.99),
        retrieved("retrieval-2", markdownSource("R2.md"), "Retrieval 2", 0.98),
      ],
      webEvidence: [],
    });

    expect(output.diagnostics.localEvidenceQuality.weak).toBe(true);
    expect(output.diagnostics.budget.policy).toBe("weak-local");
  });

  it("never requires web evidence in index-only mode", () => {
    expect(
      new EvidencePlanner().requiresWebEvidence({
        question: "What is the latest pricing?",
        searchMode: "indexOnly",
        explicitEvidence: [],
        graphEvidence: [],
        retrievalEvidence: [],
      }),
    ).toBe(false);
  });
});
