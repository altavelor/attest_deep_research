import { describe, expect, it } from "vitest";

import type { ToolCallDiagnostic } from "@core/diagnostics";
import { summarizeSubAgentTelemetry } from "@core/research";

function call(overrides: Partial<ToolCallDiagnostic> = {}): ToolCallDiagnostic {
  return {
    id: "call-1",
    name: "run_subagent",
    status: "success",
    arguments: { task: "check X" },
    round: 1,
    ...overrides,
  };
}

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

describe("summarizeSubAgentTelemetry", () => {
  it("reports the slowest run of a wave rather than its sum", () => {
    const summary = summarizeSubAgentTelemetry([
      call({ id: "a", metadata: telemetry({ runId: "run-1", durationMs: 1_000 }) }),
      call({ id: "b", metadata: telemetry({ runId: "run-2", durationMs: 4_000 }) }),
    ]);

    expect(summary.subAgents).toMatchObject({
      count: 2,
      maxDurationMs: 4_000,
      totalDurationMs: 5_000,
    });
  });

  it("counts a cache replay of the same run once, by reason and by run id", () => {
    const record = telemetry({ runId: "run-1", durationMs: 1_000, searchCalls: 4 });
    const summary = summarizeSubAgentTelemetry([
      call({ id: "a", metadata: record }),
      call({ id: "b", metadata: record, reason: "duplicate-result-reused" }),
      call({ id: "c", metadata: { ...record } }),
    ]);

    expect(summary.subAgents).toMatchObject({
      count: 1,
      searchCalls: 4,
      totalDurationMs: 1_000,
      importedSources: 3,
      droppedSources: 1,
    });
  });

  it("counts a launch that failed with an exception", () => {
    const summary = summarizeSubAgentTelemetry([
      call({ id: "a", metadata: telemetry({ runId: "run-1", durationMs: 1_000 }) }),
      call({
        id: "b",
        status: "failed",
        metadata: {
          runId: "call-b",
          durationMs: 12,
          loopDurationMs: 12,
          rounds: 0,
          maxRounds: 0,
          hitRoundLimit: false,
          failureReason: "tool-exception",
          toolCalls: 0,
          duplicateToolCalls: 0,
          searchCalls: 0,
          maxSearches: 0,
          searchBudgetRejections: 0,
          usedSynthesisFallback: false,
          answerChars: 0,
          usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
          sourceCount: 0,
          droppedSourceCount: 0,
          evidenceBudgetExhausted: false,
        },
      }),
    ]);

    expect(summary.subAgents).toMatchObject({ count: 2, totalDurationMs: 1_012 });
  });

  it("separates search calls made inside sub-agents from the orchestrator's own", () => {
    const summary = summarizeSubAgentTelemetry([
      call({ id: "s1", name: "search_web" }),
      call({ id: "s2", name: "search_index" }),
      call({ id: "s3", name: "search_web", reason: "duplicate-result-reused" }),
      call({ id: "f1", name: "fetch_web_page" }),
      call({ id: "a", metadata: telemetry({ runId: "run-1", searchCalls: 3 }) }),
    ]);

    expect(summary.subAgents).toMatchObject({ searchCalls: 3, topLevelSearchCalls: 2 });
  });

  it("counts round-limit hits and synthesis fallbacks", () => {
    const summary = summarizeSubAgentTelemetry([
      call({ id: "a", metadata: telemetry({ runId: "run-1", hitRoundLimit: true }) }),
      call({ id: "b", metadata: telemetry({ runId: "run-2", usedSynthesisFallback: true }) }),
      call({ id: "c", metadata: telemetry({ runId: "run-3" }) }),
    ]);

    expect(summary.subAgents).toMatchObject({ roundLimitHits: 1, synthesisFallbacks: 1 });
  });

  it("keeps map_sources launches in their own namespace", () => {
    const summary = summarizeSubAgentTelemetry([
      call({ id: "a", metadata: telemetry({ runId: "run-1", durationMs: 1_000 }) }),
      call({
        id: "m",
        name: "map_sources",
        metadata: {
          mapSources: [
            telemetry({ runId: "map-1", durationMs: 300, searchCalls: 1 }),
            telemetry({ runId: "map-2", durationMs: 700, searchCalls: 2 }),
          ],
        },
      }),
    ]);

    expect(summary.subAgents?.count).toBe(1);
    expect(summary.subAgents?.searchCalls).toBe(2);
    expect(summary.mapSources).toEqual({
      count: 2,
      totalDurationMs: 1_000,
      maxDurationMs: 700,
      roundLimitHits: 0,
      synthesisFallbacks: 0,
      searchCalls: 3,
    });
  });

  it("leaves the sub-agent namespace absent for a map_sources-only run", () => {
    const summary = summarizeSubAgentTelemetry([
      call({ id: "m", name: "map_sources", metadata: { mapSources: [telemetry()] } }),
    ]);

    expect(summary.subAgents).toBeUndefined();
    expect(summary.mapSources?.count).toBe(1);
  });

  it("omits both namespaces when the run launched no sub-agent", () => {
    expect(summarizeSubAgentTelemetry([call({ name: "search_web" })])).toEqual({});
    expect(summarizeSubAgentTelemetry([])).toEqual({});
  });

  it("survives telemetry of the wrong shape without counting it", () => {
    const summary = summarizeSubAgentTelemetry([
      call({ id: "a" }),
      call({ id: "b", metadata: { durationMs: 500 } as Record<string, unknown> }),
      call({ id: "c", metadata: { runId: 7 } as unknown as Record<string, unknown> }),
      call({
        id: "d",
        metadata: {
          runId: "run-ok",
          durationMs: "900",
          searchCalls: Number.NaN,
          sourceCount: -4,
        } as unknown as Record<string, unknown>,
      }),
      call({ id: "m1", name: "map_sources", metadata: { mapSources: "two" } }),
      call({ id: "m2", name: "map_sources", metadata: { mapSources: [null, 3, "x"] } }),
    ]);

    expect(summary.subAgents).toEqual({
      count: 1,
      totalDurationMs: 0,
      maxDurationMs: 0,
      roundLimitHits: 0,
      synthesisFallbacks: 0,
      searchCalls: 0,
      topLevelSearchCalls: 0,
      importedSources: 0,
      droppedSources: 0,
    });
    expect(summary.mapSources).toBeUndefined();
  });
});
