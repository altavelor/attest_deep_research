import { buildDiagnosticReportViewModel } from "../../src/ui/diagnosticFormatting";
import { formatDiagnosticReportHtml } from "../../src/ui/diagnosticHtml";
import { ContextDiagnostics } from "../../src/shared/types";

function diagnosticFixture(): ContextDiagnostics {
  return {
    reportSchemaVersion: 2,
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
    budget: { usedTokens: 10, groups: [] },
    tools: [],
    warnings: ["hostile <script>alert(1)</script>"],
    run: {
      runId: "run-1",
      answerId: "answer-1",
      status: "completed",
      startedAt: "2026-06-21T10:00:00.000Z",
      durationMs: 1200,
      lastPhase: "persistence",
      timeline: [
        { offsetMs: 0, type: "run.started" },
        { offsetMs: 1200, type: "run.completed", status: "success" },
      ],
    },
    stream: {
      protocol: "chat-completions",
      protocolSource: "profile",
      observedDialects: ["reasoning_content"],
      frameCount: 4,
      malformedFrameCount: 0,
      ignoredEventCount: 0,
      reasoningDeltaCount: 2,
      textDeltaCount: 1,
      toolDeltaCount: 0,
      synthesizedStartCount: 1,
      synthesizedEndCount: 1,
      aliasConflictCount: 0,
      terminalEventObserved: true,
      doneMarkerObserved: true,
      warnings: [],
    },
  };
}

describe("readable diagnostic HTML", () => {
  it("builds deterministic readable sections from the diagnostic snapshot", () => {
    const view = buildDiagnosticReportViewModel(diagnosticFixture());
    expect(view.identity.runId).toBe("run-1");
    expect(view.sections.map((section) => section.id)).toContain("stream");
    expect(view.timeline).toHaveLength(2);
    expect(view.rawReport).toContain('"runId": "run-1"');
  });

  it("exports escaped self-contained HTML without executable or remote resources", () => {
    const html = formatDiagnosticReportHtml(buildDiagnosticReportViewModel(diagnosticFixture()));
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Ixplorer diagnostic report");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/(?:src|href)=["']https?:/);
  });
});
