import { describe, expect, it, vi } from "vitest";

import {
  MapSourcesResultTool,
  MapSourcesTool,
} from "@adapters/research-tools/map-sources/MapSourcesTool";
import { executeTool } from "@core/agent";
import { MapSourcesFailure, type MapSources } from "@application/use-cases/map-sources";
import type { SubAgentTelemetry } from "@application/research";
import { summarizeSubAgentTelemetry, type MapSourcesBatchState } from "@core/research";

type Mapper = Partial<Pick<MapSources, "start" | "getResult" | "telemetryOf">>;

function execute(mapper: Mapper, arguments_: Record<string, unknown> = { question: "What?" }) {
  return executeTool(
    new MapSourcesTool({ mapper: mapper as MapSources, parentRunId: "parent-1" }),
    { id: "map-call", name: "map_sources", arguments: arguments_ },
    { emit: vi.fn(), round: 2 },
  );
}

const receipt = { batchId: "mapbatch-1", requested: 1, refs: [{ sessionId: "s", runId: "r" }] };

describe("MapSourcesTool", () => {
  it("returns a helpful failure when no document matches", async () => {
    const mapper = {
      start: vi
        .fn()
        .mockRejectedValue(new MapSourcesFailure("map-sources-empty", "No documents matched.")),
    };

    await expect(execute(mapper)).resolves.toMatchObject({
      ok: false,
      error: { code: "map-sources-empty", message: "No documents matched.", retryable: false },
    });
  });

  it("reports mapper failures as retryable without leaking the exception", async () => {
    const mapper = { start: vi.fn().mockRejectedValue(new Error("backend unavailable")) };

    const result = await execute(mapper);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "map-sources-failed", retryable: true },
    });
    expect(JSON.stringify(result)).not.toContain("backend unavailable");
  });

  it("accepts a batch under the call identity of the parent run and returns only its receipt", async () => {
    const mapper = { start: vi.fn().mockResolvedValue(receipt) };

    await expect(
      execute(mapper, {
        question: "Compare findings",
        sourcePaths: ["Notes/one.md"],
        maxSources: 1,
        perSourceBudget: 3,
      }),
    ).resolves.toEqual({ ok: true, value: { state: "accepted", receipt } });
    expect(mapper.start).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "Compare findings",
        sourcePaths: ["Notes/one.md"],
        maxSources: 1,
        perSourceRounds: 3,
      }),
      "parent-1-r2-map-call",
    );
  });

  it("rejects invalid fan-out arguments before starting the mapper", async () => {
    const mapper = { start: vi.fn() };

    await expect(execute(mapper, { question: "" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(mapper.start).not.toHaveBeenCalled();
  });

  it("reads the matrix separately with telemetry in the mapSources namespace only once completed", async () => {
    const telemetry: SubAgentTelemetry = {
      runId: "run-a",
      durationMs: 40,
      loopDurationMs: 40,
      rounds: 2,
      maxRounds: 0,
      hitRoundLimit: false,
      toolCalls: 1,
      duplicateToolCalls: 0,
      searchCalls: 1,
      maxSearches: 0,
      searchBudgetRejections: 0,
      usedSynthesisFallback: false,
      answerChars: 16,
      usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 0 },
    };
    const completed: MapSourcesBatchState = {
      state: "completed",
      batchId: "mapbatch-1",
      result: {
        question: "q",
        rows: [
          {
            sourcePath: "Notes/one.md",
            ok: true,
            stance: "supports",
            keyFindings: [],
            evidenceIds: [],
          },
        ],
        diagnostics: { selection: "explicit", requested: 1, completed: 1, failed: 0 },
      },
    };
    const mapper = {
      getResult: vi
        .fn()
        .mockResolvedValueOnce({ state: "pending", batchId: "mapbatch-1", completed: 0, failed: 0 })
        .mockResolvedValue(completed),
      telemetryOf: vi.fn().mockReturnValue([telemetry]),
    };
    const read = () =>
      executeTool(
        new MapSourcesResultTool({ mapper: mapper as unknown as MapSources, parentRunId: "p" }),
        { id: "read-call", name: "get_map_sources_result", arguments: { batchId: "mapbatch-1" } },
        { emit: vi.fn() },
      );

    const pending = await read();
    const result = await read();

    expect(pending.diagnostic).toBeUndefined();
    expect(result).toEqual({ ok: true, value: completed, diagnostic: { mapSources: [telemetry] } });
    const summary = summarizeSubAgentTelemetry([
      {
        id: "read-call",
        name: "get_map_sources_result",
        status: "success",
        arguments: {},
        round: 1,
        ...(result.diagnostic ? { metadata: result.diagnostic } : {}),
      },
    ]);
    expect(summary.mapSources).toMatchObject({ count: 1, searchCalls: 1, maxDurationMs: 40 });
    expect(summary.subAgents).toBeUndefined();
  });
});
