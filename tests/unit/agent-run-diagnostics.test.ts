import { AgentRunDiagnosticCollector } from "@application/use-cases/research";
import { ContextDiagnostics } from "../../src/core/diagnostics";

function emptyDiagnostics(): ContextDiagnostics {
  return {
    contextMode: "include",
    explicitSources: [],
    mentionSources: [],
    activeSources: [],
    graph: {
      enabled: false,
      source: "none",
      depth: 0,
      rootPaths: [],
      included: [],
      dropped: [],
      unresolved: [],
      limits: {
        maxForwardLinksPerRoot: 0,
        maxEmbedsPerRoot: 0,
        maxBacklinksPerRoot: 0,
        maxGraphCandidatesTotal: 0,
      },
    },
    retrieval: {
      queryVariants: [],
      includedChunkIds: [],
      droppedChunkIds: [],
      filteredSourcePaths: [],
    },
    budget: { usedTokens: 0, groups: [] },
    tools: [],
    warnings: [],
  };
}

describe("AgentRunDiagnosticCollector", () => {
  it("records bounded lifecycle and projection diagnostics without content", () => {
    const collector = new AgentRunDiagnosticCollector({
      runId: "run-1",
      answerId: "answer-1",
      now: (() => {
        let time = 1000;
        return () => (time += 10);
      })(),
      timelineLimit: 3,
    });
    collector.record({ type: "reasoning", segmentId: "r1", content: "private reasoning" });
    collector.record({ type: "checkpoint-delta", checkpointId: "c1", round: 1, content: "draft" });
    collector.record({ type: "checkpoint-complete", checkpointId: "c1", round: 1 });
    collector.record({ type: "delta", content: "final" });
    const diagnostics = emptyDiagnostics();
    collector.complete(diagnostics);

    expect(diagnostics.run).toMatchObject({
      runId: "run-1",
      status: "completed",
      omittedTimelineEvents: 3,
    });
    expect(diagnostics.projection).toMatchObject({
      reasoningSegments: 1,
      checkpointsCreated: 1,
      finalAnswersCommitted: 1,
    });
    expect(JSON.stringify(diagnostics.run)).not.toContain("private reasoning");
    expect(JSON.stringify(diagnostics.run)).not.toContain("draft");
  });
});
