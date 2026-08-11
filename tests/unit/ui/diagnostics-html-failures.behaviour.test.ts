// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { buildDiagnosticReportV3 } from "@apps/obsidian/ui/diagnostics/report/build";
import {
  renderFindings,
  renderHeader,
  renderInput,
  renderInternals,
  renderNav,
} from "@apps/obsidian/ui/diagnostics/html/sections";
import { renderRunTrace } from "@apps/obsidian/ui/diagnostics/html/trace";
import { DiagnosticReportV3 } from "@apps/obsidian/ui/diagnostics/report/types";
import { ContextDiagnostics } from "@core/diagnostics";

const HOSTILE = "<script>alert(\"x\")</script> & 'quoted'";

function parse(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

function diagnostics(overrides: Partial<ContextDiagnostics> = {}): ContextDiagnostics {
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

function failingReport(): DiagnosticReportV3 {
  return buildDiagnosticReportV3(
    diagnostics({
      question: HOSTILE,
      modelName: HOSTILE,
      executionStrategy: "thinking",
      toolCapabilities: {
        calls: false,
        choiceRequired: false,
        choiceSpecific: false,
        parallelCalls: false,
      },
      warnings: [HOSTILE],
      thinking: {
        policyReason: "tool-calls-unsupported",
        requiredTools: [],
        satisfiedTools: [],
        repairedTools: [],
        rounds: 0,
        totalCalls: 0,
        duplicateCalls: 0,
        duplicatedCost: false,
        fallbackReason: HOSTILE,
        unknownCitationIds: [HOSTILE],
      },
      retrieval: {
        queryVariants: [HOSTILE],
        includedChunkIds: [],
        droppedChunkIds: [],
        filteredSourcePaths: [],
        rankedChunks: [{ id: "chunk-1", path: HOSTILE, rank: 1, score: 0.5, status: "included" }],
      },
      index: { status: "error", available: false, errorMessage: HOSTILE },
      run: {
        runId: "run-1",
        answerId: "answer-1",
        status: "failed",
        startedAt: "2026-06-21T10:00:00.000Z",
        durationMs: 500,
        lastPhase: "reasoning",
        timeline: [],
      },
    }),
  );
}

describe("diagnostic html rendering of a failing report", () => {
  it("escapes untrusted question, model name and fallback text in the header", () => {
    const report = failingReport();
    const header = parse(renderHeader(report));

    expect(header.querySelector("script")).toBeNull();
    expect(header.querySelector(".question-text")?.textContent).toBe(HOSTILE);
    const badges = Array.from(header.querySelectorAll(".header-badges .badge")).map(
      (badge) => badge.textContent,
    );
    expect(badges).toContain(HOSTILE);
    expect(badges).toContain(`fallback: ${HOSTILE}`);
  });

  it("renders each finding with a severity class, section badge and escaped detail", () => {
    const report = failingReport();
    const container = parse(renderFindings(report.findings));

    expect(container.querySelector("script")).toBeNull();
    const findings = Array.from(container.querySelectorAll(".finding"));
    expect(findings.length).toBe(report.findings.findings.length);
    expect(findings.length).toBeGreaterThan(0);
    for (const [index, element] of findings.entries()) {
      const source = report.findings.findings[index];
      expect(element.classList.contains(`finding-${source.severity}`)).toBe(true);
      expect(element.querySelector(".finding-header strong")?.textContent).toBe(source.title);
      expect(element.querySelector(".finding-detail")?.textContent).toBe(source.detail);
      expect(element.querySelector(".finding-header .badge")?.textContent).toBe(
        source.affectedSection,
      );
    }
    expect(container.querySelector(".findings-summary")?.textContent).toBe(report.findings.summary);
  });

  it("renders nothing for a report without findings and drops its nav anchor", () => {
    const report = buildDiagnosticReportV3(diagnostics({ executionStrategy: "instant" }));

    expect(renderFindings(report.findings)).toBe("");
    const anchors = Array.from(parse(renderNav(report)).querySelectorAll(".nav-anchor")).map(
      (anchor) => anchor.textContent,
    );
    expect(anchors).not.toContain("findings");
    expect(anchors).toContain("run-trace");
  });

  it("escapes untrusted index errors, warnings and chunk paths in the input card", () => {
    const container = parse(renderInput(failingReport()));

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".callout-danger")?.textContent).toContain(HOSTILE);
    expect(container.querySelector(".callout-warning li")?.textContent).toBe(HOSTILE);
    const chunkCells = Array.from(container.querySelectorAll("table.data-table td")).map(
      (cell) => cell.textContent,
    );
    expect(chunkCells).toContain(HOSTILE);
    expect(container.querySelector("ol li")?.textContent).toBe(HOSTILE);
  });

  it("omits optional input sub-sections that the report does not carry", () => {
    const container = parse(
      renderInput(buildDiagnosticReportV3(diagnostics({ executionStrategy: "instant" }))),
    );
    const headings = Array.from(container.querySelectorAll(".sub-heading")).map(
      (heading) => heading.textContent,
    );

    expect(headings).toContain("Thinking policy");
    expect(headings).not.toContain("Index");
    expect(headings).not.toContain("Warnings");
    expect(headings).not.toContain("Ranked chunks");
    expect(headings).not.toContain("Web search (preflight)");
  });

  it("renders unknown citation ids as escaped code chips in the internals card", () => {
    const container = parse(renderInternals(failingReport()));

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".callout-danger code")?.textContent).toBe(HOSTILE);
  });

  it("renders no internals card when the report has no internals data", () => {
    expect(
      renderInternals(buildDiagnosticReportV3(diagnostics({ executionStrategy: "instant" }))),
    ).toBe("");
  });

  it("renders answer citation statistics and omits them for legacy diagnostics", () => {
    const report = buildDiagnosticReportV3(
      diagnostics({
        answer: {
          characters: 20,
          words: 4,
          sentences: 1,
          citations: {
            occurrences: 2,
            uniqueLabels: 1,
            per100Words: 50,
            sentenceCoverage: 100,
            maxLabelsPerSentence: 1,
            byLabel: { "source-1": 2 },
            uncitedPromptSourceIds: ["source-2"],
            collapsedOccurrences: 1,
            verificationRan: true,
            unknownCitationIds: [],
            unverifiedCitations: [],
          },
        },
      }),
    );
    const html = renderInternals(report);
    expect(html).toContain("Answer and citations");
    expect(html).toContain("source-1: 2");
    expect(html).toContain("source-2");
    expect(renderInternals(buildDiagnosticReportV3(diagnostics()))).not.toContain(
      "Answer and citations",
    );
  });

  it("renders a rich trace with stream, probe audit, web results, and answer delivery", () => {
    const report = failingReport();
    const mutable = report as unknown as {
      model: Record<string, unknown>;
      request: Record<string, unknown>;
      reasoning: Record<string, unknown>;
      answer: Record<string, unknown>;
    };
    mutable.model.toolCapabilities = {
      calls: true,
      choiceRequired: true,
      choiceSpecific: false,
      parallelCalls: true,
      provenance: { calls: "probe" },
      probe: {
        ranAt: "2026-08-01T00:00:00.000Z",
        modelName: "model",
        apiFormat: "openai-compatible",
        results: { required: ["search_index"], specific: [], auto: ["search_index"] },
        rawCapabilities: {
          calls: false,
          choiceRequired: true,
          choiceSpecific: false,
          parallelCalls: true,
        },
      },
    };
    mutable.request.web = {
      queryStrategy: "freshness",
      queries: ["latest retrieval research"],
      results: [{ status: "included" }, { status: "dropped" }],
      finalPrompt: { usedTokens: 42 },
    };
    mutable.reasoning.stream = {
      protocol: "responses",
      protocolSource: "probe",
      observedDialects: ["reasoning"],
      frameCount: 10,
      malformedFrameCount: 1,
      reasoningDeltaCount: 2,
      textDeltaCount: 3,
      toolDeltaCount: 1,
      terminalEventObserved: false,
      firstByteMs: 120,
      warnings: ["stream warning"],
    };
    mutable.reasoning.attempts = [
      {
        attempt: 1,
        protocol: "responses",
        status: "failed",
        outputEmitted: true,
        errorCode: "timeout",
      },
    ];
    mutable.answer.projection = {
      reasoningSegments: 2,
      checkpointsCreated: 1,
      finalAnswersCommitted: 1,
      bufferedTextChars: 20,
    };
    mutable.answer.delivery = {
      projectorEventsReceived: 4,
      uiPatchesApplied: 3,
      markdownRenders: 2,
      coalescedUpdates: 1,
      persistenceStatus: "saved",
    };
    mutable.answer.unverifiedCitations = ["citation-1"];

    const input = parse(renderInput(report));
    const internals = parse(renderInternals(report));

    expect(input.textContent).toContain("Web search (preflight)");
    expect(input.textContent).toContain("1 included / 1 dropped of 2");
    expect(input.textContent).toContain("Probe overridden by manual settings.");
    expect(internals.textContent).toContain("responses (probe)");
    expect(internals.textContent).toContain("stream warning");
    expect(internals.textContent).toContain("timeout");
    expect(internals.textContent).toContain("Persistence");
    expect(internals.textContent).toContain("citation-1");
  });

  it("renders actionable round details for continuation, empty search, and failed tool calls", () => {
    const report = failingReport();
    (report.reasoning as unknown as Record<string, unknown>).thinkingLoop = {
      rounds: [
        {
          round: 2,
          phase: "repair",
          toolCalls: [
            {
              name: "search_web",
              arguments: { query: "x".repeat(200) },
              status: "success",
              resultPreview: JSON.stringify({ results: [] }),
              resultBytes: 1250,
            },
            { name: "fetch_web_page", arguments: {}, status: "failed", reason: "timeout" },
          ],
          reasoningSegments: [{ text: "Need another source" }],
          hadTextOutput: true,
          classification: "final",
          promptDelta: {
            viaContinuation: true,
            toolChoice: "auto",
            messages: [
              {
                role: "tool",
                chars: 40,
                toolCallId: "call-1",
                toolCallNames: ["search_web"],
                truncatedChars: 5,
                content: "result",
              },
            ],
          },
        },
      ],
      stopReasons: ["completed"],
    };

    const trace = parse(renderRunTrace(report));
    expect(trace.querySelector(".trace-round")?.hasAttribute("open")).toBe(true);
    expect(trace.textContent).toContain("continuation");
    expect(trace.textContent).toContain("timeout");
    expect(trace.textContent).toContain("text output → final");
    expect(trace.querySelector(".trace-call.is-empty")).not.toBeNull();
    expect(trace.querySelector(".trace-call.is-failed")).not.toBeNull();
    expect(trace.querySelector(".trace-call-args")?.textContent).toContain("…");
  });

  it("renders context budget groups and source statuses for an operator to inspect", () => {
    const report = failingReport();
    const mutable = report as unknown as {
      preflight: { context: Record<string, unknown> };
    };
    mutable.preflight.context = {
      budget: {
        usedTokens: 900,
        limitTokens: 1000,
        utilizationPct: 90,
        groups: [
          {
            name: "Explicit",
            usedTokens: 500,
            allocatedTokens: 600,
            includedItems: 1,
            droppedItems: 0,
          },
          { name: "Retrieved", usedTokens: 400, droppedItems: 2 },
        ],
      },
      sources: [
        {
          path: `Notes/${"very-long-folder/".repeat(5)}source.md`,
          role: "explicit",
          status: "included",
          includedTokens: 500,
        },
        { path: "Notes/missing.md", role: "retrieved", status: "failed" },
        { path: "Notes/ignored.md", role: "graph", status: "dropped" },
      ],
    };

    const input = parse(renderInput(report));
    expect(input.textContent).toContain("900 / 1000 tokens (90%)");
    expect(input.textContent).toContain("Explicit");
    expect(input.textContent).toContain("Retrieved");
    expect(input.querySelectorAll(".badge-success")).not.toHaveLength(0);
    expect(input.querySelectorAll(".badge-danger")).not.toHaveLength(0);
    expect(input.querySelectorAll(".badge-neutral")).not.toHaveLength(0);
    expect(input.textContent).toContain("…");
  });

  it("uses safe header fallbacks when a run has no question, model, or identifiers", () => {
    const report = buildDiagnosticReportV3(diagnostics({ executionStrategy: "instant" }));
    const header = parse(renderHeader(report));

    expect(header.querySelector(".question-text")?.textContent).toBe("(no question recorded)");
    expect(header.querySelector(".header-badges")?.textContent).toContain("unknown");
    expect(header.querySelector(".meta")).toBeNull();
  });
});
