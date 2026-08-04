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
});
