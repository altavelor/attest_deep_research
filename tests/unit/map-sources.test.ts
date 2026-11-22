import { describe, expect, it, vi } from "vitest";

import { MapSources, MapSourcesWorkerAdapter } from "@application/use-cases/map-sources";
import {
  buildSourceTask,
  citedEvidenceIds,
  parseSourceAnswer,
} from "@application/use-cases/map-sources";
import type { ResearchRetriever } from "@application/contracts/research";
import type { MapSourcesRunContext } from "@application/ports/mapSources";
import type { RetrievedChunk } from "@core/model";
import type { MapSourcesBatchReceipt } from "@core/research";
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

function retrieverOf(chunks: RetrievedChunk[] = [], folders: string[] = []): ResearchRetriever {
  return {
    search: vi.fn().mockResolvedValue({ chunks, citations: [], usedFallback: false }),
    getSourceMetadata: async () => null,
    getIndexSourceOutline: async (path: string) => (folders.includes(path) ? null : { path }),
  } as unknown as ResearchRetriever;
}

/**
 * Builds a mapper over the fake context whose resolver gives each run one chunk of its
 * document and fails for an answer that names UNRESOLVABLE.
 */
function mapper(
  options: {
    batches?: FakeBatchStore;
    parentRunId?: string;
    chunks?: RetrievedChunk[];
    folders?: string[];
    indexPaths?: string[];
    notices?: MapSourcesRunContext["notices"];
  } = {},
) {
  const harness = mapSourcesContext({
    ...(options.notices ? { notices: options.notices } : {}),
    ...(options.batches ? { batches: options.batches } : {}),
    ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
  });
  const imported: ResearchEvidenceSnapshot[] = [];
  const retriever = retrieverOf(options.chunks, options.folders);
  const instance = new MapSources({
    runner: harness.workers,
    retriever,
    context: harness.context,
    ...(options.indexPaths ? { indexPaths: options.indexPaths } : {}),
    resolver: {
      resolve: async (outcome) => {
        if (outcome.answerText.includes("UNRESOLVABLE")) throw new Error("gone");
        return snapshot([chunk(`e-${outcome.run.subAgentRunId.slice(-6)}`, "doc.pdf")]);
      },
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
      indexPaths: ["papers"],
    });
    run.batches.holdDurable = true;
    let settled: MapSourcesBatchReceipt | null = null;
    const both = Promise.all([
      run.mapper.start({ question: " Does X hold? " }, "parent-1-r1-call"),
      run.mapper.start({ question: " Does X hold? " }, "parent-1-r1-call"),
    ]);
    void both.then(([value]) => (settled = value));
    await settle();
    expect(run.workers.inputs).toHaveLength(0);
    run.batches.heldFlushes.shift()!();
    await settle();
    expect([run.workers.inputs.length, settled]).toEqual([2, null]);
    run.batches.heldFlushes.shift()!();
    const [receipt, twin] = await both;
    run.batches.holdDurable = false;
    await run.mapper.start({ question: "Does X hold?" }, "parent-1-r1-call");

    expect(twin).toEqual(receipt);
    expect(run.retriever.search).toHaveBeenCalledTimes(1);
    expect(run.retriever.search).toHaveBeenCalledWith(
      "Does X hold?",
      expect.objectContaining({ sourcePaths: ["papers"] }),
    );
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
    const run = mapper({ folders: ["dir"] });

    const receipt = await run.mapper.start(
      {
        question: "compare",
        sourcePaths: ["a.pdf", "dir//b.pdf", "./a.pdf", "dir/"],
        perSourceRounds: 40,
      },
      "call-a",
    );

    expect(run.retriever.search).not.toHaveBeenCalled();
    expect(receipt.requested).toBe(3);
    expect(run.workers.inputs.map((input) => [input.sourcePath, input.maxRounds])).toEqual([
      ["a.pdf", 12],
      ["dir/b.pdf", 12],
    ]);
    await expect(
      run.mapper.start({ question: "q", sourcePaths: ["../secret.md"] }, "call-b"),
    ).rejects.toMatchObject({ code: "invalid-source-path" });
    await expect(
      run.mapper.start({ question: "q", sourcePaths: [`${"x".repeat(497)}.pdf`] }, "call-d"),
    ).rejects.toMatchObject({ code: "invalid-source-path" });
    await expect(run.mapper.start({ question: "x".repeat(1001) }, "call-e")).rejects.toMatchObject({
      code: "invalid-input",
      message: "question must be 1-1000 characters.",
    });
    const nine = [`${"x".repeat(496)}.pdf`, ...Array.from({ length: 8 }, (_, i) => `p${i}.pdf`)];
    const capped = await run.mapper.start(
      { question: "secret ".repeat(142), sourcePaths: nine, perSourceRounds: 1 },
      "call-f",
    );
    expect([capped.requested, run.workers.inputs.at(-1)?.maxRounds]).toEqual([8, 2]);
    const stored = run.batches.get(capped.batchId)!.question;
    expect([stored.length, stored.includes("secret")]).toEqual([1000, false]);
    const many = Array.from({ length: 21 }, (_, i) => `m${i}.pdf`);
    const wide = await run.mapper.start(
      { question: "q", sourcePaths: many, maxSources: 25 },
      "call-g",
    );
    expect(wide.requested).toBe(20);
    await expect(run.mapper.start({ question: "q" }, "call-c")).rejects.toMatchObject({
      code: "map-sources-empty",
      message: "No documents matched — provide sourcePaths or broaden the question.",
    });
  });

  it("publishes a partial matrix in selection order once every worker settled, with redacted row errors", async () => {
    const run = mapper();
    run.workers.rejected.set("d.pdf", "persistence-failed");
    const receipt = await run.mapper.start(
      { question: "q", sourcePaths: ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"] },
      "call-1",
    );
    const [a, b, c, , e] = ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"].map((path) =>
      run.workers.runIdOf(path),
    );
    run.workers.states.set(
      c!,
      workerState(c!, "completed", `${"secret".repeat(66)}\nSTANCE: OPPOSES`),
    );
    run.workers.states.set(e!, workerState(e!, "completed", "UNRESOLVABLE\nSTANCE: SUPPORTS"));
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
      ["d.pdf", false, "unclear", "persistence-failed: The document worker could not be started."],
      [
        "e.pdf",
        false,
        "unclear",
        "sources-unavailable: The document's sources could not be resolved.",
      ],
    ]);
    expect(result?.rows[2]?.keyFindings[0]).toBe("[redacted]".repeat(40));
    expect(result?.diagnostics).toEqual({
      selection: "explicit",
      requested: 5,
      completed: 1,
      failed: 4,
    });
    expect(JSON.stringify(result)).not.toContain("snapshot");
    expect(run.listenerCount()).toBe(0);
  });

  it("reports worker telemetry by real run ids with no invented tokens for an early failure", async () => {
    const run = mapper();
    const receipt = await run.mapper.start(
      { question: "q", sourcePaths: ["a.pdf", "b.pdf", "c.pdf", "d.pdf"] },
      "call-1",
    );
    const [a, b, c, d] = ["a.pdf", "b.pdf", "c.pdf", "d.pdf"].map((path) =>
      run.workers.runIdOf(path),
    );
    const cached = workerState(a!, "completed", "STANCE: SUPPORTS");
    if (cached.state === "completed") {
      const { usage } = cached.outcome.run;
      cached.outcome.run.usage = { ...usage, inputTokens: 12, cachedInputTokens: 8 };
    }
    run.workers.states.set(a!, cached);
    run.workers.states.set(c!, workerState(c!, "interrupted", "Stopped", "stopped"));
    run.workers.states.set(d!, workerState(d!, "completed", "STANCE: MIXED"));
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
    run.workers.unreachable.add(d!);

    await run.mapper.getResult(receipt.batchId);

    expect(
      run.mapper
        .telemetryOf(receipt.batchId)
        .map((entry) => [
          entry.runId,
          entry.rounds,
          entry.failureReason,
          entry.usage.inputTokens,
          entry.usage.cachedInputTokens,
        ]),
    ).toEqual([
      [a, 2, undefined, 12, 8],
      [b, 0, "provider-error", 0, 0],
      [c, 2, "cancelled", 0, 0],
    ]);
    expect(run.imported).toHaveLength(1);
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
    const lastCounters = (intents: typeof run.notices) =>
      (intents.at(-1)?.entry as { batch?: unknown }).batch;
    expect(lastCounters(run.notices)).toEqual({ total: 3, done: 0, running: 0, failed: 3 });

    const late = mapper();
    late.workers.beforeStart = async (input) => {
      if (input.sourcePath !== "b.pdf") return;
      await late.batches.interrupt("parent-1", { code: "parent-terminal", message: "Ended." });
    };
    await expect(
      late.mapper.start({ question: "q", sourcePaths: ["a.pdf", "b.pdf", "c.pdf"] }, "call-2"),
    ).rejects.toMatchObject({ code: "parent-terminal", message: "Ended." });
    expect(late.workers.inputs.map((input) => input.sourcePath)).toEqual(["a.pdf", "b.pdf"]);
    expect(late.listenerCount()).toBe(0);
    expect(lastCounters(late.notices)).toEqual({ total: 3, done: 0, running: 0, failed: 3 });

    const delegator = vi.fn();
    const worker = { requestId: "r", task: "t", sourcePath: "a.pdf", maxRounds: 2 };
    await expect(
      new MapSourcesWorkerAdapter({ delegator }).runSource({
        ...worker,
        maxResultChars: 1,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: "cancelled", message: "The fan-out was cancelled." });
    expect(delegator).not.toHaveBeenCalled();
  });

  it("fails explicitly when no document worker starts, also when the call is replayed", async () => {
    const shared = new FakeBatchStore();
    const run = mapper({ batches: shared });
    run.workers.rejected.set("a.pdf", "persistence-failed");
    const failure = { code: "workers-not-started", message: "No document worker could start." };

    await expect(
      run.mapper.start({ question: "q", sourcePaths: ["a.pdf"] }, "call-1"),
    ).rejects.toMatchObject(failure);
    const again = mapper({ batches: shared });
    await expect(
      again.mapper.start({ question: "q", sourcePaths: ["a.pdf"] }, "call-1"),
    ).rejects.toMatchObject(failure);
    expect(again.workers.inputs).toEqual([]);
    expect((run.notices.at(-1)?.entry as { batch?: unknown }).batch).toEqual({
      total: 1,
      done: 0,
      running: 0,
      failed: 1,
    });
  });

  it("keeps gathering a batch when the notice sink throws", async () => {
    const run = mapper({
      notices: {
        publish: () => {
          throw new Error("Sink closed.");
        },
      },
    });
    const receipt = await run.mapper.start({ question: "q", sourcePaths: ["a.pdf"] }, "call-1");
    const a = run.workers.runIdOf("a.pdf");
    run.workers.states.set(a, workerState(a, "completed", "STANCE: SUPPORTS"));
    run.signal();
    await settle();

    expect([run.batches.get(receipt.batchId)?.state, run.listenerCount()]).toEqual([
      "completed",
      0,
    ]);
  });

  it("fails a worker whose result cannot be read and keeps the last reading through a transient error", async () => {
    const run = mapper();
    const receipt = await run.mapper.start(
      { question: "q", sourcePaths: ["a.pdf", "b.pdf"] },
      "call-1",
    );
    const [a, b] = ["a.pdf", "b.pdf"].map((path) => run.workers.runIdOf(path));
    run.workers.states.set(a!, workerState(a!, "completed", "STANCE: SUPPORTS"));
    run.workers.states.set(b!, workerState(b!, "pending", "", "", "running"));
    run.signal();
    await settle();
    run.workers.unreachable.add(a!);
    run.signal();
    await settle();
    expect(run.batches.get(receipt.batchId)?.state).toBe("pending");

    run.workers.states.delete(b!);
    run.signal();
    await settle();

    const counters = run.notices.map((intent) => (intent.entry as { batch?: unknown }).batch);
    expect(counters).toEqual([
      { total: 2, done: 0, running: 0, failed: 0 },
      { total: 2, done: 1, running: 1, failed: 0 },
      { total: 2, done: 1, running: 0, failed: 1 },
    ]);
    expect(run.batches.get(receipt.batchId)?.result?.rows.map((row) => row.error)).toEqual([
      undefined,
      "not-authorized: The document worker's result could not be read.",
    ]);
  });

  it("publishes a last notice with nothing running when its batch is interrupted elsewhere", async () => {
    const run = mapper();
    const receipt = await run.mapper.start({ question: "q", sourcePaths: ["a.pdf"] }, "call-1");
    const a = run.workers.runIdOf("a.pdf");
    run.workers.states.set(a, workerState(a, "pending", "", "", "running"));
    run.signal();
    await settle();

    await run.batches.interrupt("parent-1", { code: "parent-terminal", message: "Ended." });
    run.signal();
    await settle();

    expect((run.notices.at(-1)?.entry as { batch?: unknown }).batch).toEqual({
      total: 1,
      done: 0,
      running: 0,
      failed: 1,
    });
    expect(run.listenerCount()).toBe(0);
    expect((await run.mapper.getResult(receipt.batchId)).state).toBe("interrupted");
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
