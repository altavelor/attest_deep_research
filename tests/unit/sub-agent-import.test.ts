import { describe, expect, it, vi } from "vitest";

import type { SubAgentPreparedImport } from "@application/ports";
import { ChatSubAgentEvidenceBridge } from "@application/use-cases/chat";
import { planSubAgentImport } from "@application/use-cases/sub-agent/importPlan";
import { removeOrphanSubAgentAliases } from "@core/chat/subAgentAliases";
import type { ConversationSourceRegistry } from "@core/chat/sourceRegistry";
import {
  applySubAgentTransition,
  recoverSubAgentState,
  rewriteSubAgentCitations,
  type SubAgentImportRecord,
} from "@core/research";
import { settle } from "../support/async";
import { subAgentSection } from "../support/chatDocuments";
import {
  applyAll,
  AT,
  childEvidence,
  delegationGrant,
  executionResult,
  FakeChatRegistry,
  importHarness,
  launchChild,
  managerHarness,
  managerParts,
  readySubAgentRecord,
  runToImport,
  sourcePolicy,
} from "../support/subAgentSessions";
import { IMPORT_TIMEOUT_MS, SubAgentExecutionAdapter } from "@application/use-cases/sub-agent";
import { scriptedModelRounds } from "../support/researchFakes";
import { runPastDeadline } from "../support/timers";

vi.mock("@shared", async (importOriginal) => {
  const { withGlobalTimers } = await import("../support/timers");
  return withGlobalTimers(await importOriginal<typeof import("@shared")>());
});

function result(answerText: string, evidence = [childEvidence("e1")], incomplete = false) {
  return { ...executionResult(answerText), evidence, incomplete };
}

function importDeltas(harness: { writer: { deltas: { entity: string; fields?: unknown }[] } }) {
  return harness.writer.deltas
    .filter((delta) => delta.entity === "import")
    .map((delta) => delta.fields as Partial<SubAgentImportRecord>);
}

type ImportHarness = ReturnType<typeof importHarness>;

function epoch(harness: ImportHarness, deliveryEpoch: number) {
  harness.probes.epoch = deliveryEpoch;
  return harness.delegator("grant-1", deliveryEpoch);
}

function forgeImport(
  harness: ImportHarness,
  change: (entry: SubAgentImportRecord) => SubAgentImportRecord,
): void {
  const { store } = managerParts(harness.manager);
  store.putImport(change(store.state!.imports.at(-1)!));
}

async function launchWith(harness: ReturnType<typeof importHarness>, resources?: string[]) {
  const delegator = harness.delegator();
  const session = await delegator.create({
    createRequestId: "create-a",
    title: "Task",
    ...(resources ? { resources } : {}),
  });
  const receipt = await delegator.run(
    session.subAgentSessionId,
    { type: "initial", task: "Find X" },
    "submit-a",
  );
  return { delegator, sessionId: session.subAgentSessionId, runId: receipt.runId };
}

describe("sub-agent evidence import", () => {
  it("U1: rewrites every citation-bearing field to this import's aliases", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness, ["example.com"]);
    harness.execution.finish(
      0,
      result(
        "A [e1] B [url:https://example.com/e1] C [parent-src] D [e2] [a note] token=[redacted] [src-9].",
        [
          childEvidence("e1"),
          childEvidence("e2", { source: { kind: "web", url: "https://other.org/x", title: "O" } }),
        ],
      ),
    );
    await settle();

    const state = await delegator.getResult(sessionId, runId);
    expect(state.state).toBe("completed");
    if (state.state !== "completed") return;
    const alias = state.outcome.evidence[0].conversationEvidenceId;
    expect(state.outcome.evidence).toHaveLength(1);
    expect(state.outcome.answerText).toBe(
      `A [${alias}] B [${alias}] C [source unavailable] D [source unavailable] [a note] token=[redacted] [source unavailable].`,
    );
    expect(state.outcome.run.resultSummary).toBe(state.outcome.answerText);
    expect(JSON.stringify(state.outcome)).not.toMatch(/\[(e1|e2|parent-src|url:[^\]]*)\]/);
    expect(harness.chat.registry.sources[0].id).toBe(
      state.outcome.evidence[0].conversationSourceId,
    );
    expect(JSON.stringify(harness.writer.deltas)).not.toMatch(/\[(e1|e2|parent-src|url:[^\]]*)\]/);
  });

  it("U1: drops web sources beyond the parent's remaining capacity at prepare", async () => {
    const harness = importHarness();
    let reads = 0;
    harness.grants.set(
      "grant-1",
      delegationGrant(harness.binding, { remainingWebCapacity: () => ((reads += 1), 1) }),
    );
    const { delegator, sessionId, runId } = await launchWith(harness);
    harness.execution.finish(
      0,
      result("[e1] [e2] [e3]", [childEvidence("e1"), childEvidence("e2"), childEvidence("e3")]),
    );
    await settle();

    const state = await delegator.getResult(sessionId, runId);

    expect(state.state).toBe("completed");
    if (state.state !== "completed") return;
    expect(state.outcome.evidence).toHaveLength(1);
    expect(state.outcome.evidenceBudgetExhausted).toBe(true);
    expect(state.outcome.answerText.match(/source unavailable/g)).toHaveLength(2);
    expect(importDeltas(harness)[0].evidenceBudgetExhausted).toBe(true);
    expect(reads).toBe(1);
    for (const capacity of [
      () => {
        throw new Error("registry gone");
      },
      () => Number.NaN,
      () => Number.POSITIVE_INFINITY,
    ]) {
      const invalid = importHarness();
      invalid.grants.set(
        "grant-1",
        delegationGrant(invalid.binding, { remainingWebCapacity: capacity }),
      );
      const launched = await launchWith(invalid);
      invalid.execution.finish(0, result("[e1]"));
      await settle();
      const read = await launched.delegator.getResult(launched.sessionId, launched.runId);
      expect(read.state === "completed" && read.outcome).toMatchObject({
        evidence: [],
        evidenceBudgetExhausted: true,
      });
    }
  });

  it("U1: resolves prior evidence into bounded redacted excerpts that a continue-partial run returns", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness, ["example.com"]);
    const text = `SECRET ${"x".repeat(3000)}`;
    harness.execution.finish(0, result("A [e1]", [childEvidence("e1", { text })]));
    await settle();
    const state = await delegator.getResult(sessionId, runId);
    if (state.state !== "completed") throw new Error("The first run did not complete.");
    const items = harness.bridge.priorEvidenceItems(state.outcome.evidence, (value) =>
      value.replace("SECRET", "[redacted]"),
    );
    const tasks: string[] = [];
    const adapter = new SubAgentExecutionAdapter({
      selectModel: () => ({
        model: { profileId: "p", providerId: "openai", modelId: "m", label: "M" },
        modelRound: scriptedModelRounds(() => ({ items: [], stopReason: "complete" })),
      }),
      createRunner: () => ({
        run: async (input) => {
          tasks.push(input.task);
          return { answerText: "Done", snapshot: { evidence: [], citations: [], provenance: [] } };
        },
      }),
      now: () => new Date(AT),
    });
    const [first] = harness.execution.requests;
    const run = await adapter.run({
      ...first!,
      priorContext: { ...first!.priorContext, continuesPartial: true, priorEvidenceItems: items },
    });

    expect(items.map((item) => [item.text.length, item.text.startsWith("[redacted]")])).toEqual([
      [1000, true],
    ]);
    expect(tasks[0]).toContain(items[0]!.text);
    expect(run.evidence).toEqual([
      expect.objectContaining({ id: state.outcome.evidence[0]!.conversationEvidenceId }),
    ]);
  });

  it("U2: replays a prepare with the same importId and registers its source once", async () => {
    const input = {
      chatId: "chat-1",
      sessionId: "session-1",
      runId: "run-1",
      generation: 1,
      attempt: 1,
      policy: sourcePolicy(),
      resources: [],
      webCapacity: Number.POSITIVE_INFINITY,
      incomplete: false,
      now: AT,
    };
    const first = planSubAgentImport({
      ...input,
      result: result("[e1][e2]", [childEvidence("e1"), childEvidence("e2")]),
    });
    const replay = planSubAgentImport({
      ...input,
      incomplete: true,
      result: result("[e1][e2]", [childEvidence("e2"), childEvidence("e1")], true),
    });
    const chat = new FakeChatRegistry();
    const bridge = new ChatSubAgentEvidenceBridge(
      chat.context(() => ({ isCurrent: () => true, committed: () => null })),
    );
    const request = (prepared: SubAgentPreparedImport) => ({
      sessionId: "session-1",
      runId: "run-1",
      result: executionResult(),
      prepared,
    });

    const registered = await bridge.commit(request(first.prepared));
    const again = await bridge.commit(request(replay.prepared));

    expect(replay.prepared.importId).toBe(first.prepared.importId);
    expect(replay.prepared.generation).toBe(1);
    expect(replay.prepared.answerText).toBe(first.prepared.answerText);
    expect(chat.registry.sources).toHaveLength(2);
    expect(again.outcome.evidence.map((alias) => alias.conversationRevisionId)).toEqual(
      registered.outcome.evidence.map((alias) => alias.conversationRevisionId),
    );
    for (const currentChecks of [2, 3]) {
      const fenced = new FakeChatRegistry();
      let checks = 0;
      const late = new ChatSubAgentEvidenceBridge(
        fenced.context(() => ({
          isCurrent: () => (checks += 1) <= currentChecks,
          committed: () => null,
        })),
      );
      await expect(late.commit(request(first.prepared))).rejects.toMatchObject({
        code: "import-failed",
      });
      expect(fenced.attempts).toBe(currentChecks - 2);
      expect(fenced.registry.sources).toHaveLength(2);
    }
  });

  it("U3: a tombstone wins over a late registry save, the commit marker and repair", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness);
    const release = harness.chat.holdNext();
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();

    const parts = managerParts(harness.manager);
    const pending = parts.store.state!.imports.at(-1)!;
    const live = parts.imports.isCurrent(pending as never);
    forgeImport(harness, (entry) => ({ ...entry, chatId: "chat-2" }));
    const foreign = parts.imports.isCurrent(pending as never);
    forgeImport(harness, (entry) => ({
      ...entry,
      chatId: "chat-1",
      state: "tombstoned",
      tombstoneReason: "stopped",
    }));
    release();
    await settle();
    const state = await delegator.getResult(sessionId, runId);
    await epoch(harness, 2).getResult(sessionId, runId);
    await settle();

    expect(state).toMatchObject({ state: "failed", error: { code: "import-failed" } });
    expect(importDeltas(harness).some((fields) => fields.state === "committed")).toBe(false);
    expect(harness.chat.attempts).toBe(1);
    expect([live, foreign]).toEqual([true, false]);
    await expect(
      harness.bridge.resolve({ importId: "x", run: { subAgentRunId: runId } } as never),
    ).rejects.toMatchObject({ code: "import-failed" });
  });

  it("U4: keeps generations monotonic and archives an unsafe successor", async () => {
    const harness = importHarness();
    const { delegator, sessionId } = await launchWith(harness);
    harness.execution.finish(0, result("First [e1]"));
    await settle();
    const followUp = await delegator.continue(
      sessionId,
      { type: "follow-up", task: "More" },
      "s-2",
    );
    harness.chat.failNext(new Error("disk full"));
    harness.execution.finish(1, result("Second [e1]"));
    await settle();
    await delegator.continue(
      sessionId,
      { type: "continue-partial", task: "Finish", fromRunId: followUp.runId },
      "s-3",
    );
    harness.execution.finish(2, result("Third [e1]"));
    await settle();
    const unsafe = importHarness();
    const launched = await launchWith(unsafe);
    const { store } = managerParts(unsafe.manager);
    const record = store.record(launched.sessionId)!;
    store.putRecord({
      ...record,
      session: { ...record.session, lastImportGeneration: Number.MAX_SAFE_INTEGER },
    });
    unsafe.execution.finish(0, result("Answer [e1]"));
    await settle();
    const corrupt = await launched.delegator.getResult(launched.sessionId, launched.runId);
    const exhaustedRecord = applyAll(readySubAgentRecord(), runToImport("run-1").slice(0, 2));
    const rejected = applySubAgentTransition(
      {
        ...exhaustedRecord,
        session: { ...exhaustedRecord.session, lastImportGeneration: Number.MAX_SAFE_INTEGER },
      },
      runToImport("run-1")[2],
    );
    const final = await delegator.getResult(sessionId, harness.execution.requests[2].runId);

    const generations = (state: string) =>
      importDeltas(harness)
        .filter((fields) => fields.state === state)
        .map((fields) => fields.generation);
    expect(generations("committed")).toEqual([1, 3]);
    expect(
      new Set(
        importDeltas(harness)
          .filter((fields) => fields.state === "prepared")
          .map((fields) => fields.importId),
      ).size,
    ).toBe(3);
    expect(final.state === "completed" && final.outcome.evidence[0].incomplete).toBe(true);
    expect(corrupt).toMatchObject({
      state: "interrupted",
      error: {
        code: "checkpoint-corrupt",
        message: "Сохранённое состояние дочерних агентов повреждено.",
      },
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: "checkpoint-corrupt" } });
  });

  it("U5: repairs a failed import once per new epoch without re-running the child", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness);
    const release = harness.chat.holdNext();
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();
    harness.writer.failNext(new Error("disk full"));
    release();
    await settle();

    const failed = await delegator.getResult(sessionId, runId);
    const followUp = await delegator
      .continue(sessionId, { type: "follow-up", task: "More" }, "s-2")
      .catch((error: { code: string }) => error.code);
    await delegator.getResult(sessionId, runId);
    await settle();
    const attemptsInFailedEpoch = harness.chat.attempts;
    const hung = harness.chat.holdNext();
    const second = epoch(harness, 2);
    await runPastDeadline(IMPORT_TIMEOUT_MS + 1, () => second.getResult(sessionId, runId));
    hung();
    await settle();
    const afterTimeout = await second.getResult(sessionId, runId);
    const third = epoch(harness, 6);
    await third.getResult(sessionId, runId);
    await settle();
    const repaired = await third.getResult(sessionId, runId);

    expect(failed).toMatchObject({ state: "failed", error: { code: "import-failed" } });
    expect(JSON.stringify(failed)).not.toContain("Answer");
    expect(followUp).toBe("invalid-state");
    expect(attemptsInFailedEpoch).toBe(1);
    expect(afterTimeout.state).toBe("failed");
    expect(harness.chat.attempts).toBe(3);
    expect(repaired.state).toBe("completed");
    expect(repaired.resultRevision).toBeGreaterThan(failed.resultRevision);
    expect(harness.chat.registry.sources).toHaveLength(1);
    expect(harness.execution.requests).toHaveLength(1);
  });

  it("U5: repairs a committed import whose alias was lost, once per epoch", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness);
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();
    const healthy = await delegator.getResult(sessionId, runId);
    await settle();
    const lose = () => (harness.chat.registry = { sources: [] });
    const deltasBeforeNoOp = harness.writer.deltas.length;
    const flushesBeforeNoOp = harness.writer.flushes;
    const noOp = await epoch(harness, 2).getResult(sessionId, runId);
    await settle();
    const afterNoOp = await harness.delegator("grant-1", 2).getResult(sessionId, runId);
    const deltasAfterNoOp = harness.writer.deltas.length;
    const flushesAfterNoOp = harness.writer.flushes;

    lose();
    harness.chat.failNext(new Error("disk full"));
    const second = epoch(harness, 5);
    await second.getResult(sessionId, runId);
    await settle();
    const broken = await second.getResult(sessionId, runId);
    await settle();
    const attemptsInSecondEpoch = harness.chat.attempts;
    const third = epoch(harness, 3);
    await third.getResult(sessionId, runId);
    await settle();
    const restored = await third.getResult(sessionId, runId);
    lose();
    forgeImport(harness, (entry) => ({ ...entry, state: "tombstoned" }));
    await epoch(harness, 7).getResult(sessionId, runId);
    await settle();

    expect(noOp.resultRevision).toBe(healthy.resultRevision);
    expect(afterNoOp.resultRevision).toBe(healthy.resultRevision);
    expect(deltasAfterNoOp).toBe(deltasBeforeNoOp);
    expect(flushesAfterNoOp).toBe(flushesBeforeNoOp);
    expect(broken).toMatchObject({ state: "failed", error: { code: "import-failed" } });
    expect(broken.resultRevision).toBe(healthy.resultRevision + 1);
    expect(restored.resultRevision).toBe(healthy.resultRevision + 2);
    expect(attemptsInSecondEpoch).toBe(2);
    expect(restored.state).toBe("completed");
    expect(harness.chat.attempts).toBe(3);
    expect(harness.chat.registry.sources).toHaveLength(0);
  });

  it("U6: an old epoch is fenced while a new epoch retrieves the same imported result", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness);
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();
    const before = await delegator.getResult(sessionId, runId);

    harness.probes.epoch = 2;
    const old = await delegator
      .getResult(sessionId, runId)
      .catch((error: { code: string }) => error.code);
    const renewed = await harness.delegator("grant-1", 2).getResult(sessionId, runId);

    const resolved = renewed.state === "completed" ? renewed.outcome : null;
    const evidence = await harness.bridge.resolve(resolved!);
    await harness.manager.closeAll("parent-1", "failed");

    expect(old).toBe("fenced-delivery");
    expect(renewed).toEqual(before);
    expect(evidence.evidence.map((chunk) => chunk.id)).toEqual([
      resolved!.evidence[0].conversationEvidenceId,
    ]);
    await expect(harness.bridge.resolve(resolved!)).rejects.toMatchObject({
      code: "import-failed",
    });
  });

  it("U7: closing the parent during a registry save fences without deadlock or outcome", async () => {
    const harness = importHarness();
    await launchWith(harness);
    const release = harness.chat.holdNext();
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();

    const closed = await harness.manager.closeAll("parent-1", "failed");
    release();
    await settle();

    expect(closed.durable).toBe(true);
    expect(importDeltas(harness).at(-1)).toMatchObject({
      state: "tombstoned",
      tombstoneReason: "parent-terminal",
    });
    expect(importDeltas(harness).some((fields) => fields.state === "committed")).toBe(false);
    expect(harness.chat.attempts).toBe(1);
  });

  it("U8: imports only allowed hosts, search provenance and ten web sources", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness, ["example.com"]);
    const web = Array.from({ length: 11 }, (_, index) => childEvidence(`w${index}`));
    harness.execution.finish(
      0,
      result("[w0] [w10] [bad] [far] [n1] [n2] [n3]", [
        ...web,
        childEvidence("bad", { tool: "read_note" }),
        childEvidence("far", { source: { kind: "web", url: "https://evil.org/", title: "E" } }),
        childEvidence("n1", {
          source: { kind: "markdown", path: "Research/A.md", title: "A" },
          tool: "search_index",
        }),
        childEvidence("n2", {
          source: { kind: "markdown", path: "Private/B.md", title: "B" },
          tool: "search_index",
        }),
        childEvidence("n3", {
          source: { kind: "markdown", path: "Research/..\\Private.md", title: "C" },
          tool: "search_index",
        }),
      ]),
    );
    await settle();

    const state = await delegator.getResult(sessionId, runId);

    expect(state.state).toBe("completed");
    if (state.state !== "completed") return;
    const imported = state.outcome.evidence.map((alias) => alias.subAgentEvidenceId);
    expect(imported).toHaveLength(11);
    expect(imported).toContain("n1");
    expect(imported).not.toContain("w10");
    expect(state.outcome.answerText.match(/source unavailable/g)).toHaveLength(5);
  });

  it("U8: an admitted element without an alias fails the import with its message", async () => {
    const harness = managerHarness();
    const { session, receipt } = await launchChild(harness.delegator(), "a");
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();

    const state = await harness.delegator().getResult(session.subAgentSessionId, receipt.runId);

    expect(state).toMatchObject({
      state: "failed",
      error: {
        code: "import-failed",
        message: "Не удалось импортировать результат дочернего агента.",
      },
    });
  });

  it("U8: a forged prepared record is never repaired", async () => {
    const harness = importHarness();
    const { sessionId, runId } = await launchWith(harness);
    harness.chat.failNext(new Error("disk full"));
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();
    type Item = { chunk: { source: object } & Record<string, unknown> } & Record<string, unknown>;
    const forgeries: ((item: Item) => object)[] = [
      (item) => ({
        ...item,
        chunk: { ...item.chunk, source: { ...item.chunk.source, url: "javascript:alert(1)" } },
      }),
      (item) => ({
        ...item,
        chunk: { ...item.chunk, source: { ...item.chunk.source, title: "t".repeat(2_000_000) } },
      }),
      (item) => ({ ...item, calls: [{ callId: "c", tool: "write_note" }] }),
      (item) => ({ ...item, attempt: 1.5 }),
      (item) => ({
        ...item,
        conversationEvidenceId: "subagent:import-other:1",
        chunk: { ...item.chunk, id: "subagent:import-other:1" },
      }),
    ];

    const { store } = managerParts(harness.manager);
    const original = store.state!.imports.at(-1)!.evidence[0] as unknown as Item;
    for (const [index, forge] of forgeries.entries()) {
      forgeImport(harness, (entry) => ({ ...entry, evidence: [forge(original) as never] }));
      await epoch(harness, index + 2).getResult(sessionId, runId);
      await settle();
    }

    expect(harness.chat.attempts).toBe(1);
  });

  it("U9: startup tombstones a pending import and cleanup keeps cited artifacts", () => {
    const record = applyAll(readySubAgentRecord(), runToImport("run-1"));
    const pending: SubAgentImportRecord = {
      state: "prepared",
      importId: "import-a",
      chatId: "chat-1",
      sessionId: "session-1",
      runId: "run-1",
      evidenceDigest: "digest",
      generation: 1,
      evidence: [],
      aliases: [],
      answerText: "",
      createdAt: AT,
    };
    const recovered = recoverSubAgentState(subAgentSection([record], { imports: [pending] }), AT);
    const chunk = (id: string) => ({
      id,
      source: { id, kind: "markdown" as const, title: id, path: "Research/A.md", headingPath: [] },
      text: id,
      contentHash: id,
      score: 1,
    });
    const revision = (id: string, chunks: string[], cited: boolean, status = "active") => ({
      id,
      contentHash: id,
      capturedAt: AT,
      chunks: chunks.map(chunk),
      status: status as "active",
      usages: cited ? [{ messageId: "m1", citationOffsets: [0] }] : [],
    });
    const registry: ConversationSourceRegistry = {
      sources: [
        {
          id: "source-1",
          identity: { kind: "markdown", canonicalKey: "Research/A.md" },
          title: "A",
          revisions: [
            revision("source-1:revision-1", ["subagent:import-a:1"], true, "superseded"),
            revision("source-1:revision-2", ["subagent:import-a:2", "parent-chunk"], false),
          ],
        },
        {
          id: "source-2",
          identity: { kind: "markdown", canonicalKey: "Research/B.md" },
          title: "B",
          revisions: [revision("source-2:revision-1", ["subagent:import-a:3"], false)],
        },
      ],
    };

    const cleaned = removeOrphanSubAgentAliases(registry, recovered);

    expect(recovered.imports[0]).toMatchObject({
      state: "tombstoned",
      tombstoneReason: "crash-recovery",
    });
    expect(cleaned.sources.map((source) => source.id)).toEqual(["source-1"]);
    expect(cleaned.sources[0].revisions.map((entry) => entry.chunks.map((c) => c.id))).toEqual([
      ["subagent:import-a:1"],
      ["parent-chunk"],
    ]);
    expect(removeOrphanSubAgentAliases(registry, subAgentSection([record]))).toBe(registry);
  });

  it("U10: rewrites newline-free bracket floods in bounded work", () => {
    for (const unit of ["[", "[a", "[a]("]) {
      const text = unit.repeat(20_000);
      expect(rewriteSubAgentCitations(text, new Map(), new Set())).toBe(text);
    }
  });
});
