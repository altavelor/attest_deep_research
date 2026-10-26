import { describe, expect, it, vi } from "vitest";

import { MapSources } from "@application/use-cases/map-sources";
import {
  buildSourceTask,
  citedEvidenceIds,
  parseSourceAnswer,
} from "@application/use-cases/map-sources";
import type { ResearchRetriever } from "@application/contracts/research";
import type { RetrievedChunk } from "@core/model";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import { settle } from "../support/async";
import { FakeBatchStore, mapSourcesContext, workerState } from "../support/mapSourcesFakes";

function chunk(id: string, path: string): RetrievedChunk {
  return {
    id,
    text: `text of ${id}`,
    contentHash: id,
    score: 1,
    source: { id: path, kind: "pdf", title: path, path, pageNumber: 1 },
  };
}

function snapshot(chunks: RetrievedChunk[]): ResearchEvidenceSnapshot {
  return { evidence: chunks, citations: [], provenance: [] };
}

function retrieverOf(chunks: RetrievedChunk[] = []): ResearchRetriever {
  return {
    search: vi.fn().mockResolvedValue({ chunks, citations: [], usedFallback: false }),
  } as unknown as ResearchRetriever;
}

/** Builds a mapper over the fake context whose resolver gives each run one chunk of its document. */
function mapper(
  options: { batches?: FakeBatchStore; parentRunId?: string; chunks?: RetrievedChunk[] } = {},
) {
  const harness = mapSourcesContext({
    ...(options.batches ? { batches: options.batches } : {}),
    ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
  });
  const imported: ResearchEvidenceSnapshot[] = [];
  const retriever = retrieverOf(options.chunks);
  const instance = new MapSources({
    runner: harness.workers,
    retriever,
    context: harness.context,
    resolver: {
      resolve: async (outcome) =>
        snapshot([chunk(`e-${outcome.run.subAgentRunId.slice(-6)}`, "doc.pdf")]),
    },
    evidence: { importRegisteredSnapshot: (value) => void imported.push(value) },
  });
  return { ...harness, mapper: instance, retriever, imported };
}

describe("map-sources parsing", () => {
  it("extracts stance and findings, tolerating case and bullet markers", () => {
    const answer = [
      "- The paper argues the effect is real [e1].",
      "* A caveat about sample size [e2].",
      "stance: SUPPORTS",
    ].join("\n");
    const parsed = parseSourceAnswer(answer);
    expect(parsed.stance).toBe("supports");
    expect(parsed.keyFindings).toEqual([
      "The paper argues the effect is real [e1].",
      "A caveat about sample size [e2].",
    ]);
  });

  it("defaults to unclear when no stance line is present", () => {
    expect(parseSourceAnswer("Some finding.").stance).toBe("unclear");
  });

  it("cites only evidence ids that appear in the answer, else the whole snapshot", () => {
    const snap = snapshot([chunk("e1", "a.pdf"), chunk("e2", "a.pdf")]);
    expect(citedEvidenceIds("relies on [e2] only", snap)).toEqual(["e2"]);
    expect(citedEvidenceIds("no citations here", snap)).toEqual(["e1", "e2"]);
  });

  it("scopes the task to one document path", () => {
    const task = buildSourceTask("Does X hold?", "papers/a.pdf");
    expect(task).toContain("papers/a.pdf");
    expect(task).toContain("STANCE:");
  });
});

describe("MapSources batches", () => {
  it("selects by relevance once and returns the receipt after the durable refs, before any result", async () => {
    const run = mapper({
      chunks: [chunk("x", "a.pdf"), chunk("y", "./a.pdf"), chunk("z", "b.pdf")],
    });

    const receipt = await run.mapper.start({ question: " Does X hold? " }, "parent-1-r1-call");

    expect(run.retriever.search).toHaveBeenCalledTimes(1);
    expect(receipt).toEqual({
      batchId: expect.stringMatching(/^mapbatch-[0-9a-f]{24}$/u),
      requested: 2,
      refs: run.workers.inputs.map((input) => ({
        sessionId: `session-${input.requestId}`,
        runId: `run-${input.requestId}`,
      })),
    });
    expect(run.batches.puts.map(({ state, durable }) => [state, durable])).toEqual([
      ["preparing", true],
      ["preparing", false],
      ["preparing", false],
      ["pending", true],
    ]);
    expect(
      run.workers.inputs.map(({ sourcePath, maxRounds, maxResultChars }) => [
        sourcePath,
        maxRounds,
        maxResultChars,
      ]),
    ).toEqual([
      ["a.pdf", 6, 20_000],
      ["b.pdf", 6, 20_000],
    ]);
    expect(run.workers.inputs[0]?.task).toBe(buildSourceTask("Does X hold?", "a.pdf"));
    expect(run.batches.get(receipt.batchId)).toMatchObject({
      selection: "relevance",
      state: "pending",
    });
    expect(run.notices).toHaveLength(1);
  });

  it("maps explicit canonical paths without selection and rejects traversal or an empty selection", async () => {
    const run = mapper();

    const receipt = await run.mapper.start(
      { question: "compare", sourcePaths: ["a.pdf", "dir//b.pdf", "./a.pdf"], perSourceRounds: 40 },
      "call-a",
    );

    expect(run.retriever.search).not.toHaveBeenCalled();
    expect(receipt.requested).toBe(2);
    expect(run.workers.inputs.map((input) => [input.sourcePath, input.maxRounds])).toEqual([
      ["a.pdf", 12],
      ["dir/b.pdf", 12],
    ]);
    await expect(
      run.mapper.start({ question: "q", sourcePaths: ["../secret.md"] }, "call-b"),
    ).rejects.toMatchObject({ code: "invalid-source-path" });
    await expect(run.mapper.start({ question: "q" }, "call-c")).rejects.toMatchObject({
      code: "map-sources-empty",
      message: "No documents matched — provide sourcePaths or broaden the question.",
    });
  });

  it("publishes a partial matrix in selection order once every worker settled, with redacted row errors", async () => {
    const run = mapper();
    const receipt = await run.mapper.start(
      { question: "q", sourcePaths: ["a.pdf", "b.pdf", "c.pdf"] },
      "call-1",
    );
    const [a, b, c] = ["a.pdf", "b.pdf", "c.pdf"].map((path) => run.workers.runIdOf(path));
    run.workers.states.set(c!, workerState(c!, "completed", "Finding [x]\nSTANCE: OPPOSES"));
    run.workers.states.set(
      a!,
      workerState(a!, "failed", "provider secret token", "provider-failed"),
    );
    run.signal();
    await settle();
    expect(run.batches.get(receipt.batchId)?.state).toBe("pending");

    run.workers.states.set(b!, workerState(b!, "interrupted", "Stopped by user", "stopped"));
    run.signal();
    await settle();

    const result = run.batches.get(receipt.batchId)?.result;
    expect(result?.rows.map((row) => [row.sourcePath, row.ok, row.stance, row.error])).toEqual([
      ["a.pdf", false, "unclear", "provider-failed: provider [redacted] token"],
      ["b.pdf", false, "unclear", "stopped: Stopped by user"],
      ["c.pdf", true, "opposes", undefined],
    ]);
    expect(result?.diagnostics).toEqual({
      selection: "explicit",
      requested: 3,
      completed: 1,
      failed: 2,
    });
    expect(JSON.stringify(result)).not.toContain("snapshot");
    expect(run.listenerCount()).toBe(0);
  });

  it("reports worker telemetry by real run ids with no invented tokens for an early failure", async () => {
    const run = mapper();
    const receipt = await run.mapper.start(
      { question: "q", sourcePaths: ["a.pdf", "b.pdf"] },
      "call-1",
    );
    const [a, b] = ["a.pdf", "b.pdf"].map((path) => run.workers.runIdOf(path));
    run.workers.states.set(a!, workerState(a!, "completed", "STANCE: SUPPORTS"));
    const early = workerState(b!, "failed", "denied", "execution-denied");
    if (early.state === "failed") {
      early.run.usage = {
        requestCount: 0,
        modelRounds: 0,
        toolCalls: 0,
        durationMs: 0,
        source: "unavailable",
      };
    }
    run.workers.states.set(b!, early);
    run.signal();
    await settle();

    await run.mapper.getResult(receipt.batchId);

    expect(
      run.mapper
        .telemetryOf(receipt.batchId)
        .map((entry) => [entry.runId, entry.rounds, entry.failureReason, entry.usage.inputTokens]),
    ).toEqual([
      [a, 2, undefined, 0],
      [b, 0, "provider-error", 0],
    ]);
  });

  it("interrupts a batch whose parent run ends while its workers start", async () => {
    const run = mapper();
    run.workers.rejected.set("b.pdf", "not-authorized");

    await expect(
      run.mapper.start({ question: "q", sourcePaths: ["a.pdf", "b.pdf", "c.pdf"] }, "call-1"),
    ).rejects.toMatchObject({ code: "parent-terminal" });

    const [record] = run.batches.records.values();
    expect(record).toMatchObject({
      state: "interrupted",
      error: { code: "parent-terminal", message: "The parent run ended before the batch started." },
    });
    expect(run.workers.inputs.map((input) => input.sourcePath)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("U1: keeps stable worker identities, replays without new workers and conflicts on other input", async () => {
    const shared = new FakeBatchStore();
    const first = mapper({ batches: shared });
    first.workers.rejected.set("b.pdf", "persistence-failed");
    const partial = await first.mapper.start(
      { question: "q", sourcePaths: ["a.pdf", "b.pdf"] },
      "call-1",
    );
    const [, input] = first.workers.inputs;
    shared.records.set(partial.batchId, { ...shared.get(partial.batchId)!, state: "preparing" });

    const again = mapper({ batches: shared });
    const replayed = await again.mapper.start(
      { question: "q", sourcePaths: ["a.pdf", "b.pdf"] },
      "call-1",
    );

    expect(again.workers.inputs).toEqual([input]);
    expect(input?.requestId).toMatch(new RegExp(`^${partial.batchId}-[0-9a-f]{16}$`, "u"));
    expect(replayed.refs).toEqual([
      ...partial.refs,
      { sessionId: `session-${input?.requestId}`, runId: `run-${input?.requestId}` },
    ]);
    expect(
      await again.mapper.start({ question: "q", sourcePaths: ["a.pdf", "b.pdf"] }, "call-1"),
    ).toEqual(replayed);
    expect(again.workers.inputs).toHaveLength(1);
    await expect(
      again.mapper.start({ question: "other", sourcePaths: ["a.pdf"] }, "call-1"),
    ).rejects.toMatchObject({ code: "idempotency-conflict" });
  });

  it("U2: isolates batches by run and chat, never waits while pending and reads a terminal matrix again", async () => {
    const shared = new FakeBatchStore();
    const run = mapper({ batches: shared });
    const receipt = await run.mapper.start(
      { question: "q", sourcePaths: ["b.pdf", "a.pdf"] },
      "call-1",
    );
    const otherRun = mapper({ batches: shared, parentRunId: "parent-2" });

    expect(await otherRun.mapper.getResult(receipt.batchId)).toEqual({
      state: "failed",
      batchId: receipt.batchId,
      error: {
        code: "unknown-batch",
        message: "No map_sources batch with this id belongs to this run.",
      },
    });
    expect((await run.mapper.getResult("mapbatch-missing")).state).toBe("failed");
    expect(await run.mapper.getResult(receipt.batchId)).toEqual({
      state: "pending",
      batchId: receipt.batchId,
      completed: 0,
      failed: 0,
    });

    const [b, a] = ["b.pdf", "a.pdf"].map((path) => run.workers.runIdOf(path));
    run.workers.states.set(a!, workerState(a!, "completed", "A finding [x] secret\nSTANCE: MIXED"));
    run.workers.states.set(b!, workerState(b!, "completed", "B finding\nSTANCE: SUPPORTS"));
    run.signal();
    await settle();
    run.workers.states.set(a!, workerState(a!, "failed", "late", "import-failed"));

    const first = await run.mapper.getResult(receipt.batchId);
    const second = await run.mapper.getResult(receipt.batchId);

    expect(second).toEqual(first);
    expect(
      first.state === "completed" &&
        first.result.rows.map((row) => [row.sourcePath, row.keyFindings]),
    ).toEqual([
      ["b.pdf", ["B finding"]],
      ["a.pdf", ["A finding [x] [redacted]"]],
    ]);
    expect(JSON.stringify([...shared.records.values()])).not.toContain("secret");
    expect(run.imported[0]?.provenance[0]?.calls).toEqual([
      { callId: "call-1", query: "b.pdf", tool: "search_index" },
    ]);
  });
});
