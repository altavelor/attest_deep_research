import { describe, expect, it, vi } from "vitest";

import { MapSourcesTool } from "@adapters/research-tools/map-sources/MapSourcesTool";
import { executeTool } from "@core/agent";
import type { MapSources } from "@application/use-cases/map-sources";
import type { EvidenceRegistry } from "@application/sources";
import type { SubAgentTelemetry } from "@application/research";

function execute(
  mapper: Pick<MapSources, "run">,
  evidence = { registerIndexChunk: vi.fn() },
  emit = vi.fn(),
  arguments_: Record<string, unknown> = { question: "What do the documents conclude?" },
) {
  return executeTool(
    new MapSourcesTool({
      mapper: mapper as MapSources,
      evidence: evidence as unknown as EvidenceRegistry,
    }),
    { id: "map-call", name: "map_sources", arguments: arguments_ },
    { emit },
  );
}

describe("MapSourcesTool", () => {
  it("returns a helpful failure when no document matches", async () => {
    const mapper = { run: vi.fn().mockResolvedValue({ rows: [] }) };

    await expect(execute(mapper)).resolves.toMatchObject({
      ok: false,
      error: { code: "map-sources-empty", retryable: false },
    });
  });

  it("reports mapper failures as retryable without leaking the exception", async () => {
    const mapper = { run: vi.fn().mockRejectedValue(new Error("backend unavailable")) };

    await expect(execute(mapper)).resolves.toMatchObject({
      ok: false,
      error: { code: "map-sources-failed", retryable: true },
    });
  });

  it("emits source progress, returns rows, and registers only indexed evidence", async () => {
    const indexedChunk = {
      id: "chunk-1",
      source: { kind: "document", path: "Notes/one.md" },
    };
    const webChunk = { id: "web-1", source: { kind: "web", url: "https://example.test" } };
    const mapper = {
      run: vi.fn(async (input) => {
        input.onProgress?.({
          type: "source-start",
          sourcePath: "Notes/one.md",
          index: 0,
          total: 1,
        });
        return {
          question: input.question,
          rows: [
            {
              sourcePath: "Notes/one.md",
              ok: false,
              stance: "mixed",
              keyFindings: ["One limitation"],
              evidenceIds: ["chunk-1"],
              error: "partial result",
              snapshot: { evidence: [indexedChunk, webChunk] },
            },
          ],
          diagnostics: { selection: "explicit", requested: 1, completed: 0, failed: 1 },
        };
      }),
    };
    const evidence = { registerIndexChunk: vi.fn() };
    const emit = vi.fn();

    await expect(
      execute(mapper as unknown as Pick<MapSources, "run">, evidence, emit, {
        question: "Compare findings",
        sourcePaths: ["Notes/one.md"],
        maxSources: 1,
        perSourceBudget: 3,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        question: "Compare findings",
        rows: [expect.objectContaining({ error: "partial result", evidenceIds: ["chunk-1"] })],
        diagnostics: { selection: "explicit", failed: 1 },
      },
    });
    expect(mapper.run).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePaths: ["Notes/one.md"], maxSources: 1, perSourceRounds: 3 }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sub-agent-phase", message: "Analyzing one.md (1/1)…" }),
    );
    expect(evidence.registerIndexChunk).toHaveBeenCalledWith(indexedChunk, {
      callId: "map-call",
      query: "Notes/one.md",
    });
  });

  it("rejects invalid fan-out arguments before starting the mapper", async () => {
    const mapper = { run: vi.fn() };

    await expect(execute(mapper, undefined, undefined, { question: "" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(mapper.run).not.toHaveBeenCalled();
  });
  it("reports sub-agent telemetry in the mapSources namespace, not in the tool value", async () => {
    const telemetry: SubAgentTelemetry = {
      runId: "run-a",
      durationMs: 40,
      loopDurationMs: 40,
      rounds: 2,
      maxRounds: 6,
      hitRoundLimit: false,
      toolCalls: 1,
      duplicateToolCalls: 0,
      searchCalls: 1,
      maxSearches: 8,
      searchBudgetRejections: 0,
      usedSynthesisFallback: false,
      answerChars: 16,
      usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 0 },
    };
    const mapper = {
      run: vi.fn().mockResolvedValue({
        question: "q",
        rows: [
          {
            sourcePath: "Notes/one.md",
            ok: true,
            stance: "supports",
            keyFindings: [],
            evidenceIds: [],
            snapshot: { evidence: [] },
          },
        ],
        diagnostics: {
          selection: "explicit",
          requested: 1,
          completed: 1,
          failed: 0,
          subAgents: [telemetry],
        },
      }),
    };

    const result = await execute(mapper as unknown as Pick<MapSources, "run">);

    expect(result.ok).toBe(true);
    expect(result.diagnostic).toEqual({ mapSources: [telemetry] });
    expect(JSON.stringify(result.ok ? result.value : {})).not.toContain("runId");
  });
});
