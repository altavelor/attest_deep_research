import { describe, expect, it } from "vitest";

import { buildDiagnosticReportV3 } from "@apps/obsidian/ui/diagnostics/report/build";
import {
  buildModelSection,
  buildPreflightSection,
  buildRequestSection,
  buildStatsSection,
} from "@apps/obsidian/ui/diagnostics/report/sections";
import { ContextDiagnostics } from "@core/diagnostics";

function baseDiagnostics(overrides: Partial<ContextDiagnostics> = {}): ContextDiagnostics {
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
    ...overrides,
  };
}

function failingDiagnostics(): ContextDiagnostics {
  return baseDiagnostics({
    question: "why did this fail?",
    executionStrategy: "thinking",
    toolCapabilities: {
      calls: false,
      choiceRequired: false,
      choiceSpecific: false,
      parallelCalls: false,
    },
    thinking: {
      policyReason: "tool-calls-unsupported",
      requiredTools: ["search_index", "search_web"],
      satisfiedTools: ["search_index"],
      repairedTools: [],
      rounds: 2,
      totalCalls: 0,
      duplicateCalls: 0,
      duplicatedCost: false,
      unknownCitationIds: ["c9"],
      unverifiedCitations: ["c3"],
    },
    index: { status: "ready", available: true, isStale: true, indexedFiles: 0 },
    retrieval: {
      queryVariants: ["q"],
      includedChunkIds: [],
      droppedChunkIds: ["a", "b"],
      filteredSourcePaths: [],
      rankedChunks: [
        { id: "a", path: "a.md", rank: 1, score: 0.2, status: "dropped", dropReason: "policy" },
        { id: "b", path: "b.md", rank: 2, score: 0.1, status: "dropped", dropReason: "policy" },
      ],
    },
    budget: { usedTokens: 96, limitTokens: 100, groups: [] },
    stream: {
      protocol: "chat-completions",
      protocolSource: "profile",
      observedDialects: [],
      frameCount: 3,
      malformedFrameCount: 1,
      ignoredEventCount: 0,
      reasoningDeltaCount: 0,
      textDeltaCount: 1,
      toolDeltaCount: 0,
      synthesizedStartCount: 0,
      synthesizedEndCount: 0,
      aliasConflictCount: 0,
      terminalEventObserved: false,
      doneMarkerObserved: false,
      warnings: [],
    },
  });
}

describe("diagnostic findings for a failing run", () => {
  it("reports every failure branch and orders errors before warnings and info", () => {
    const report = buildDiagnosticReportV3(failingDiagnostics());
    const codes = report.findings.findings.map((finding) => finding.code);

    expect(codes).toContain("tool-calls-blocked");
    expect(codes).toContain("thinking-policy-fallback");
    expect(codes).toContain("mandatory-tool-unsatisfied");
    expect(codes).toContain("all-chunks-dropped");
    expect(codes).toContain("index-files-zero-but-chunks-found");
    expect(codes).toContain("thinking-loop-zero-tool-calls");
    expect(codes).toContain("context-near-limit");
    expect(codes).toContain("stream-terminal-missing");
    expect(codes).toContain("unknown-citations");
    expect(codes).toContain("unverified-citations");
    expect(codes).toContain("index-stale");

    const severities = report.findings.findings.map((finding) => finding.severity);
    const rank = { error: 0, warning: 1, info: 2 } as const;
    expect(severities.map((severity) => rank[severity])).toEqual(
      [...severities].map((severity) => rank[severity]).sort((a, b) => a - b),
    );
  });

  it("names only the unsatisfied required tools in the evidence", () => {
    const report = buildDiagnosticReportV3(failingDiagnostics());
    const finding = report.findings.findings.find(
      (candidate) => candidate.code === "mandatory-tool-unsatisfied",
    );

    expect(finding?.evidence.unsatisfied).toEqual(["search_web"]);
  });

  it("summarises errors by code when errors are present", () => {
    const report = buildDiagnosticReportV3(failingDiagnostics());

    expect(report.findings.summary).toMatch(/^3 error\(s\) found: /);
    expect(report.findings.summary).toContain("tool-calls-blocked");
  });

  it("summarises warnings only when no error was found", () => {
    const report = buildDiagnosticReportV3(
      baseDiagnostics({
        executionStrategy: "instant",
        stream: {
          protocol: "chat-completions",
          protocolSource: "profile",
          observedDialects: [],
          frameCount: 1,
          malformedFrameCount: 0,
          ignoredEventCount: 0,
          reasoningDeltaCount: 0,
          textDeltaCount: 1,
          toolDeltaCount: 0,
          synthesizedStartCount: 0,
          synthesizedEndCount: 0,
          aliasConflictCount: 0,
          terminalEventObserved: false,
          doneMarkerObserved: false,
          warnings: [],
        },
      }),
    );

    expect(report.findings.summary).toBe("No errors. 1 warning(s): stream-terminal-missing.");
  });

  it("reports no issues for a clean instant run", () => {
    const report = buildDiagnosticReportV3(baseDiagnostics({ executionStrategy: "instant" }));

    expect(report.findings.findings).toEqual([]);
    expect(report.findings.summary).toBe("No issues detected.");
  });
});

describe("diagnostic report sections with missing optional data", () => {
  it("keeps optional model sub-sections null instead of inventing them", () => {
    const model = buildModelSection(baseDiagnostics());

    expect(model).toMatchObject({
      name: "",
      apiFormat: null,
      executionStrategy: "unknown",
      reasoning: null,
    });
    expect(model.toolCapabilities.probe).toBeNull();
    expect(model.toolCapabilities.calls).toBe(false);
    expect(model.toolCapabilities.provenance).toEqual({});
  });

  it("reports the capability provenance recorded alongside the capabilities", () => {
    const model = buildModelSection({
      ...baseDiagnostics(),
      capabilityProvenance: { calls: "probe" },
    });

    expect(model.toolCapabilities.provenance).toEqual({ calls: "probe" });
  });

  it("reports the capability provenance of chats saved with it inside the thinking section", () => {
    const model = buildModelSection({
      ...baseDiagnostics(),
      thinking: {
        policyReason: "thinking-eligible",
        requiredTools: [],
        satisfiedTools: [],
        repairedTools: [],
        rounds: 0,
        totalCalls: 0,
        duplicateCalls: 0,
        duplicatedCost: false,
        capabilityProvenance: { calls: "manual" },
      },
    });

    expect(model.toolCapabilities.provenance).toEqual({ calls: "manual" });
  });

  it("leaves index sections null and utilization null without a context limit", () => {
    const preflight = buildPreflightSection(baseDiagnostics());

    expect(preflight.index).toBeNull();
    expect(preflight.indexDescription).toBeNull();
    expect(preflight.context.budget.limitTokens).toBeNull();
    expect(preflight.context.budget.utilizationPct).toBeNull();
    expect(preflight.context.graph.enabled).toBe(false);
  });

  it("omits an error message that the index did not report", () => {
    const preflight = buildPreflightSection(
      baseDiagnostics({ index: { status: "error", available: false } }),
    );

    expect(preflight.index).toEqual({
      status: "error",
      available: false,
      isStale: false,
      indexedFiles: 0,
    });
  });

  it("reports no score statistics when nothing was ranked", () => {
    const request = buildRequestSection(baseDiagnostics());

    expect(request.retrieval?.scoreStats).toBeNull();
    expect(request.thinkingPolicy.policyReason).toBe("unknown");
    expect(request.web).toBeNull();
    expect(request.evidencePlanner).toBeNull();
  });

  it("falls back to neutral run statistics when the run never started", () => {
    const stats = buildStatsSection(baseDiagnostics());

    expect(stats).toEqual({
      runId: "",
      answerId: "",
      status: "unknown",
      startedAt: "",
      durationMs: 0,
      lastPhase: "",
      timeline: [],
    });
  });
});
