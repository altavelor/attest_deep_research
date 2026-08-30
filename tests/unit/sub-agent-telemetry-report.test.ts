import { describe, expect, it } from "vitest";

import { buildDiagnosticReportV3 } from "@apps/obsidian/ui/diagnostics/report/build";
import { renderInternals } from "@apps/obsidian/ui/diagnostics/html/sections";
import type { ContextDiagnostics, ThinkingAttemptDiagnostics } from "@core/diagnostics";

function telemetry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run-1",
    durationMs: 1_000,
    loopDurationMs: 900,
    rounds: 3,
    maxRounds: 12,
    hitRoundLimit: false,
    toolCalls: 4,
    duplicateToolCalls: 0,
    searchCalls: 2,
    maxSearches: 8,
    searchBudgetRejections: 0,
    usedSynthesisFallback: false,
    answerChars: 120,
    usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0 },
    sourceCount: 3,
    droppedSourceCount: 1,
    evidenceBudgetExhausted: false,
    ...overrides,
  };
}

function thinking(overrides: Partial<ThinkingAttemptDiagnostics> = {}): ThinkingAttemptDiagnostics {
  return {
    policyReason: "thinking-eligible",
    requiredTools: [],
    bootstrapChoice: { type: "auto" },
    satisfiedTools: [],
    repairedTools: [],
    rounds: 1,
    totalCalls: 1,
    duplicateCalls: 0,
    duplicatedCost: false,
    phases: ["research"],
    ...overrides,
  };
}

function diagnostics(overrides: Partial<ContextDiagnostics> = {}): ContextDiagnostics {
  return {
    contextMode: "include",
    question: "What is X?",
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

describe("sub-agent telemetry in the diagnostic report", () => {
  it("keeps the per-call telemetry on the run_subagent call through redaction", () => {
    const report = buildDiagnosticReportV3(
      diagnostics({
        thinking: thinking(),
        tools: [
          {
            id: "call-1",
            name: "run_subagent",
            status: "success",
            arguments: { task: "check X" },
            round: 1,
            metadata: telemetry({ runId: "run-1", durationMs: 2_500 }),
          },
        ],
      }),
    );

    const call = report.reasoning.thinkingLoop?.rounds[0]?.toolCalls[0];
    expect(call?.name).toBe("run_subagent");
    expect(call?.metadata).toMatchObject({
      runId: "run-1",
      durationMs: 2_500,
      loopDurationMs: 900,
      searchCalls: 2,
      sourceCount: 3,
      droppedSourceCount: 1,
    });
  });

  it("aggregates the wave into a run summary that reports the slowest run", () => {
    const report = buildDiagnosticReportV3(
      diagnostics({
        thinking: thinking({ rounds: 1, totalCalls: 3 }),
        tools: [
          {
            id: "s1",
            name: "search_web",
            status: "success",
            arguments: {},
            round: 1,
            resultPreview: "{}",
          },
          {
            id: "call-1",
            name: "run_subagent",
            status: "success",
            arguments: { task: "a" },
            round: 1,
            metadata: telemetry({ runId: "run-1", durationMs: 1_000, searchCalls: 1 }),
          },
          {
            id: "call-2",
            name: "run_subagent",
            status: "success",
            arguments: { task: "b" },
            round: 1,
            metadata: telemetry({ runId: "run-2", durationMs: 4_000, searchCalls: 2 }),
          },
        ],
      }),
    );

    expect(report.reasoning.thinkingLoop?.subAgents).toMatchObject({
      count: 2,
      totalDurationMs: 5_000,
      maxDurationMs: 4_000,
      searchCalls: 3,
      topLevelSearchCalls: 1,
      importedSources: 6,
      droppedSources: 2,
    });
    expect(report.reasoning.thinkingLoop?.mapSources).toBeUndefined();
  });

  it("counts a cache replay of the same sub-agent once", () => {
    const record = telemetry({ runId: "run-1", durationMs: 1_500 });
    const report = buildDiagnosticReportV3(
      diagnostics({
        thinking: thinking({ totalCalls: 2, duplicateCalls: 1 }),
        tools: [
          {
            id: "call-1",
            name: "run_subagent",
            status: "success",
            arguments: { task: "a" },
            round: 1,
            metadata: record,
          },
          {
            id: "call-2",
            name: "run_subagent",
            status: "success",
            arguments: { task: "a" },
            round: 1,
            reason: "duplicate-result-reused",
            metadata: record,
          },
        ],
      }),
    );

    expect(report.reasoning.thinkingLoop?.subAgents).toMatchObject({
      count: 1,
      totalDurationMs: 1_500,
    });
  });

  it("keeps map_sources launches out of the sub-agent count", () => {
    const report = buildDiagnosticReportV3(
      diagnostics({
        thinking: thinking(),
        tools: [
          {
            id: "call-1",
            name: "map_sources",
            status: "success",
            arguments: { question: "q" },
            round: 1,
            metadata: {
              mapSources: [
                telemetry({ runId: "map-1", durationMs: 400 }),
                telemetry({ runId: "map-2", durationMs: 800 }),
              ],
            },
          },
        ],
      }),
    );

    expect(report.reasoning.thinkingLoop?.subAgents).toBeUndefined();
    expect(report.reasoning.thinkingLoop?.mapSources).toMatchObject({
      count: 2,
      maxDurationMs: 800,
    });
  });

  it("prefers the summary the producer already recorded", () => {
    const report = buildDiagnosticReportV3(
      diagnostics({
        thinking: thinking({
          subAgents: {
            count: 5,
            totalDurationMs: 50,
            maxDurationMs: 30,
            roundLimitHits: 1,
            synthesisFallbacks: 2,
            searchCalls: 7,
            topLevelSearchCalls: 3,
            importedSources: 9,
            droppedSources: 4,
          },
        }),
        tools: [
          {
            id: "call-1",
            name: "run_subagent",
            status: "success",
            arguments: { task: "a" },
            round: 1,
            metadata: telemetry({ runId: "run-1" }),
          },
        ],
      }),
    );

    expect(report.reasoning.thinkingLoop?.subAgents?.count).toBe(5);
  });

  it("reads and renders a report recorded before telemetry existed", () => {
    const report = buildDiagnosticReportV3(
      diagnostics({
        thinking: thinking(),
        tools: [
          {
            id: "call-1",
            name: "run_subagent",
            status: "success",
            arguments: { task: "a" },
            round: 1,
          },
        ],
      }),
    );

    expect(report.reasoning.thinkingLoop?.subAgents).toBeUndefined();
    expect(report.reasoning.thinkingLoop?.mapSources).toBeUndefined();
    expect(renderInternals(report)).not.toContain("Sub-agents");
    expect(renderInternals(report)).not.toContain("Sub-agents (map_sources)");
  });

  it("renders both namespaces as separate blocks", () => {
    const report = buildDiagnosticReportV3(
      diagnostics({
        thinking: thinking(),
        tools: [
          {
            id: "call-1",
            name: "run_subagent",
            status: "success",
            arguments: { task: "a" },
            round: 1,
            metadata: telemetry({ runId: "run-1", durationMs: 2_000 }),
          },
          {
            id: "call-2",
            name: "map_sources",
            status: "success",
            arguments: { question: "q" },
            round: 1,
            metadata: { mapSources: [telemetry({ runId: "map-1", durationMs: 700 })] },
          },
        ],
      }),
    );

    const html = renderInternals(report);
    expect(html).toContain(">Sub-agents<");
    expect(html).toContain(">Sub-agents (map_sources)<");
    expect(html).toContain("2.0 s");
    expect(html).toContain("700 ms");
  });

  it("renders the map_sources block alone when no sub-agent was launched directly", () => {
    const report = buildDiagnosticReportV3(
      diagnostics({
        thinking: thinking(),
        tools: [
          {
            id: "call-1",
            name: "map_sources",
            status: "success",
            arguments: { question: "q" },
            round: 1,
            metadata: { mapSources: [telemetry({ runId: "map-1", durationMs: 700 })] },
          },
        ],
      }),
    );

    const html = renderInternals(report);
    expect(html).toContain("Sub-agents (map_sources)");
    expect(html).not.toContain(">Sub-agents<");
  });
});
