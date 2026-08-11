import { formatDiagnosticReportHtml } from "@apps/obsidian/ui/diagnostics/html/document";
import { ContextDiagnostics } from "@core/diagnostics";

function diagnosticFixture(): ContextDiagnostics {
  return {
    reportSchemaVersion: 2,
    contextMode: "include",
    question: "What is the meaning of life?",
    modelName: "gpt-4o",
    modelApiFormat: "openai-compatible",
    searchMode: "indexOnly",
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

describe("readable diagnostic HTML (v3)", () => {
  it("exports escaped self-contained HTML without executable or remote resources", () => {
    const html = formatDiagnosticReportHtml(diagnosticFixture());
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Attest");

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/(?:src|href)=["']https?:/);
  });

  it("shows the user question prominently in the header", () => {
    const html = formatDiagnosticReportHtml(diagnosticFixture());
    expect(html).toContain("What is the meaning of life?");
  });

  it("shows run identity in the page", () => {
    const html = formatDiagnosticReportHtml(diagnosticFixture());
    expect(html).toContain("run-1");
  });

  it("renders stream section with frame count", () => {
    const html = formatDiagnosticReportHtml(diagnosticFixture());

    expect(html).toContain("4");
  });

  it("includes nav bar with section anchors", () => {
    const html = formatDiagnosticReportHtml(diagnosticFixture());
    expect(html).toContain("top-nav");
    expect(html).toContain('href="#run-trace"');
    expect(html).toContain('href="#input"');
    expect(html).toContain('href="#internals"');
  });

  it("keeps reference sections collapsed by default", () => {
    const html = formatDiagnosticReportHtml(diagnosticFixture());
    expect(html).toContain('id="input"');
    expect(html).toContain('id="internals"');
    expect(html).toMatch(/<details class="card card-collapsed" id="input">/);
  });

  it("omits the stats timeline card", () => {
    const html = formatDiagnosticReportHtml(diagnosticFixture());
    expect(html).not.toContain('id="timeline"');
    expect(html).not.toContain('href="#timeline"');
  });

  it("renders the per-round incremental prompt delta", () => {
    const diagnostics = diagnosticFixture();
    diagnostics.thinking = {
      policyReason: "thinking-eligible",
      requiredTools: [],
      satisfiedTools: [],
      repairedTools: [],
      rounds: 2,
      totalCalls: 1,
      duplicateCalls: 0,
      duplicatedCost: false,
      phases: ["bootstrap", "research"],
      promptDeltas: [
        {
          round: 1,
          toolChoice: '{"type":"auto"}',
          messages: [{ role: "user", chars: 22, content: "system prompt <contents>" }],
        },
        {
          round: 2,
          toolChoice: '{"type":"auto"}',
          messages: [{ role: "tool", chars: 100, toolCallId: "call-1" }],
        },
      ],
    };
    const html = formatDiagnosticReportHtml(diagnostics);

    expect(html).toContain("system prompt &lt;contents&gt;");
    expect(html).toContain("call-1");
    expect(html).toContain("Prompt Δ");
  });

  it("is a self-contained single HTML file with inlined CSS", () => {
    const html = formatDiagnosticReportHtml(diagnosticFixture());
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link\s+rel=["']stylesheet/);
    expect(html).not.toMatch(/@import\s+url\(/);
  });
});
