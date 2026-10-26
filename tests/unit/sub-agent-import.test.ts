import { describe, expect, it } from "vitest";

import type { SubAgentPreparedImport } from "@application/ports";
import { ChatSubAgentEvidenceBridge } from "@application/use-cases/chat";
import { planSubAgentImport } from "@application/use-cases/sub-agent/importPlan";
import { removeOrphanSubAgentAliases } from "@core/chat/subAgentAliases";
import type { ConversationSourceRegistry } from "@core/chat/sourceRegistry";
import {
  applySubAgentTransition,
  recoverSubAgentState,
  type SubAgentImportRecord,
} from "@core/research";
import { settle } from "../support/async";
import { subAgentSection } from "../support/chatDocuments";
import {
  applyAll,
  AT,
  childEvidence,
  executionResult,
  FakeChatRegistry,
  importHarness,
  launchChild,
  managerHarness,
  readySubAgentRecord,
  runToImport,
  sourcePolicy,
} from "../support/subAgentSessions";

function result(answerText: string, evidence = [childEvidence("e1")], incomplete = false) {
  return { ...executionResult(answerText), evidence, incomplete };
}

function importDeltas(harness: { writer: { deltas: { entity: string; fields?: unknown }[] } }) {
  return harness.writer.deltas
    .filter((delta) => delta.entity === "import")
    .map((delta) => delta.fields as Partial<SubAgentImportRecord>);
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
      result("A [e1] B [url:https://example.com/e1] C [parent-src] D [e2] [a note].", [
        childEvidence("e1"),
        childEvidence("e2", { source: { kind: "web", url: "https://other.org/x", title: "O" } }),
      ]),
    );
    await settle();

    const state = await delegator.getResult(sessionId, runId);

    expect(state.state).toBe("completed");
    if (state.state !== "completed") return;
    const alias = state.outcome.evidence[0].conversationEvidenceId;
    expect(state.outcome.evidence).toHaveLength(1);
    expect(state.outcome.answerText).toBe(
      `A [${alias}] B [${alias}] C [source unavailable] D [source unavailable] [a note].`,
    );
    expect(state.outcome.run.resultSummary).toBe(state.outcome.answerText);
    expect(JSON.stringify(state.outcome)).not.toMatch(/\[(e1|e2|parent-src|url:[^\]]*)\]/);
    expect(harness.chat.registry.sources[0].id).toBe(
      state.outcome.evidence[0].conversationSourceId,
    );
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
      now: AT,
    };
    const first = planSubAgentImport({
      ...input,
      result: result("[e1][e2]", [childEvidence("e1"), childEvidence("e2")]),
    });
    const replay = planSubAgentImport({
      ...input,
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
  });

  it("U3: a tombstone wins over a late registry save, the commit marker and repair", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness);
    const release = harness.chat.holdNext();
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();

    await delegator.stop(sessionId);
    release();
    await settle();
    harness.probes.epoch = 2;
    const state = await harness.delegator("grant-1", 2).getResult(sessionId, runId);
    await settle();

    expect(state).toMatchObject({ state: "interrupted", error: { code: "import-cancelled" } });
    expect(importDeltas(harness).map((fields) => fields.state)).toEqual(["prepared", "tombstoned"]);
    expect(harness.chat.attempts).toBe(1);
    await expect(
      harness.bridge.resolve({ importId: "x", run: { subAgentRunId: runId } } as never),
    ).rejects.toMatchObject({ code: "import-failed" });
  });

  it("U4: keeps generations monotonic and refuses an unsafe successor", async () => {
    const harness = importHarness();
    const { delegator, sessionId } = await launchWith(harness);
    harness.execution.finish(0, result("First [e1]"));
    await settle();
    await delegator.continue(sessionId, { type: "follow-up", task: "More" }, "s-2");
    harness.execution.finish(1, result("Second [e1]"));
    await settle();
    const exhausted = applyAll(readySubAgentRecord(), runToImport("run-1").slice(0, 2));
    const corrupt = applySubAgentTransition(
      {
        ...exhausted,
        session: { ...exhausted.session, lastImportGeneration: Number.MAX_SAFE_INTEGER },
      },
      runToImport("run-1")[2],
    );

    const prepared = importDeltas(harness).filter((fields) => fields.state === "committed");
    expect(prepared.map((fields) => fields.generation)).toEqual([1, 2]);
    expect(new Set(prepared.map((fields) => fields.importId)).size).toBe(2);
    expect(corrupt).toMatchObject({ ok: false, error: { code: "checkpoint-corrupt" } });
  });

  it("U5: repairs a failed import once per new epoch without re-running the child", async () => {
    const harness = importHarness();
    const { delegator, sessionId, runId } = await launchWith(harness);
    harness.chat.failNext(new Error("disk full"));
    harness.execution.finish(0, result("Answer [e1]"));
    await settle();

    const failed = await delegator.getResult(sessionId, runId);
    const followUp = await delegator
      .continue(sessionId, { type: "follow-up", task: "More" }, "s-2")
      .catch((error: { code: string }) => error.code);
    await delegator.getResult(sessionId, runId);
    await settle();
    const attemptsInFailedEpoch = harness.chat.attempts;
    harness.probes.epoch = 2;
    const next = harness.delegator("grant-1", 2);
    await next.getResult(sessionId, runId);
    await settle();
    const repaired = await next.getResult(sessionId, runId);

    expect(failed).toMatchObject({ state: "failed", error: { code: "import-failed" } });
    expect(JSON.stringify(failed)).not.toContain("Answer");
    expect(followUp).toBe("invalid-state");
    expect(attemptsInFailedEpoch).toBe(1);
    expect(harness.chat.attempts).toBe(2);
    expect(repaired.state).toBe("completed");
    expect(repaired.resultRevision).toBeGreaterThan(failed.resultRevision);
    expect(harness.chat.registry.sources).toHaveLength(1);
    expect(harness.execution.requests).toHaveLength(1);
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

    expect(old).toBe("fenced-delivery");
    expect(renewed).toEqual(before);
    expect(renewed.state === "completed" && renewed.outcome.evidence).toHaveLength(1);
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
      result("[w0] [w10] [bad] [far] [n1] [n2]", [
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
    expect(state.outcome.answerText.match(/source unavailable/g)).toHaveLength(4);
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
});
