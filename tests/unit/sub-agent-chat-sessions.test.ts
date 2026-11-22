import { describe, expect, it } from "vitest";

import { SUB_AGENT_TOOL } from "@core/agent/toolNames";
import {
  applySubAgentTransition,
  buildSubAgentSessionsSection,
  buildThinkingPromptSections,
  listSubAgentPromptSessions,
  validateSubAgentState,
  type SubAgentSessionFailure,
  type SubAgentSessionRecord,
  type SubAgentTransition,
} from "@core/research";
import { settle } from "../support/async";
import { subAgentSection } from "../support/chatDocuments";
import {
  AT,
  delegationGrant,
  launchChild,
  managerHarness,
  managerParts,
  nextParentRun,
  readySubAgentRecord,
  runToImport,
  applyAll,
  sourcePolicy,
} from "../support/subAgentSessions";

async function failureOf(promise: Promise<unknown>): Promise<SubAgentSessionFailure> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error as SubAgentSessionFailure,
  );
}

function sessionStatus(harness: ReturnType<typeof managerHarness>, sessionId: string) {
  return harness.manager
    .inspection()
    .snapshot()
    .then((snapshot) => snapshot.sessions.find((card) => card.sessionId === sessionId));
}

describe("chat-scoped sub-agent sessions", () => {
  it("continues a finished session from a later parent run and places it on that run", async () => {
    const harness = managerHarness();
    const first = harness.delegator();
    const { session } = await launchChild(first, "a");
    harness.execution.finish(0);
    await settle();
    await harness.manager.closeAll("parent-1", "completed");

    const { delegator } = nextParentRun(harness);
    const receipt = await delegator.continue(
      session.subAgentSessionId,
      { type: "follow-up", task: "Ask again" },
      "submit-turn-2",
    );
    const stale = await failureOf(first.getResult(session.subAgentSessionId, receipt.runId));
    const replay = await failureOf(
      delegator.run(
        session.subAgentSessionId,
        { type: "initial", task: "Investigate a" },
        "submit-a",
      ),
    );
    await settle();

    const dispatches = harness.mainEvents.filter((intent) => intent.type === "dispatch");
    expect(dispatches.map((intent) => intent.entry.parentRunId)).toEqual(["parent-1", "parent-2"]);
    expect(harness.execution.requests.map((request) => request.task)).toEqual([
      "Investigate a",
      "Ask again",
    ]);
    expect(harness.manager.listRunRefs("parent-2")).toEqual([
      { sessionId: session.subAgentSessionId, runId: receipt.runId },
    ]);
    expect(stale.code).toBe("fenced-delivery");
    expect(replay.code).toBe("idempotency-conflict");
  });

  it("narrows a continued session to the current grant's sources, active file and searches", async () => {
    const harness = managerHarness();
    const { session } = await launchChild(harness.delegator(), "a");
    harness.execution.finish(0);
    await settle();
    await harness.manager.closeAll("parent-1", "completed");
    const { binding, delegator } = nextParentRun(harness);
    harness.grants.set(
      "grant-parent-2",
      delegationGrant(binding, {
        maximumSourcePolicy: sourcePolicy({
          searchMode: "webOnly",
          contextPaths: ["Research/Sub"],
          allowActiveFile: false,
        }),
        limits: { maxRounds: 6, maxResultChars: 4000, maxSearches: 2 },
      }),
    );

    await delegator.continue(session.subAgentSessionId, { type: "follow-up", task: "More" }, "s-2");
    await settle();
    const request = harness.execution.requests[1];

    expect(harness.execution.requests[0]?.limits.maxSearches).toBe(5);
    expect(request?.sourcePolicy).toMatchObject({
      searchMode: "webOnly",
      contextPaths: ["Research/Sub"],
      allowActiveFile: false,
    });
    expect(request?.activeFilePath).toBeUndefined();
    expect(request?.limits.maxSearches).toBe(2);
  });

  it("refuses map_sources worker sessions and foreign records to a direct caller", async () => {
    const harness = managerHarness();
    harness.grants.set("grant-map", delegationGrant(harness.binding, { origin: "map_sources" }));
    const worker = await launchChild(harness.delegator("grant-map"), "w");
    const unstarted = await harness
      .delegator("grant-map")
      .create({ createRequestId: "create-unstarted", title: "Unstarted worker" });
    harness.execution.finish(0);
    await settle();
    const foreign = applyAll(readySubAgentRecord("session-foreign"), runToImport("run-x"));
    managerParts(harness.manager).store.putRecord({
      ...foreign,
      session: { ...foreign.session, chatSessionId: "chat-2" },
    });

    const direct = harness.delegator();
    const follow = await failureOf(
      direct.continue(worker.session.subAgentSessionId, { type: "follow-up", task: "x" }, "s-x"),
    );
    const read = await failureOf(direct.getResult("session-foreign", "run-x"));
    const start = await failureOf(
      direct.run(unstarted.subAgentSessionId, { type: "initial", task: "x" }, "s-y"),
    );

    expect(follow.code).toBe("not-authorized");
    expect(start.code).toBe("not-authorized");
    expect(read.code).toBe("not-authorized");
  });

  it("interrupts active work on parent terminal and lets a later run retry and continue it", async () => {
    const harness = managerHarness();
    const first = harness.delegator();
    const retried = await launchChild(first, "a");
    const partial = await launchChild(first, "b");
    const idle = await first.create({ createRequestId: "create-idle", title: "Idle" });
    await harness.manager.closeAll("parent-1", "completed");
    const closedNotices = harness.mainEvents.filter(
      (intent) => intent.type === "notice" && intent.entry.kind === "closed",
    );

    expect((await sessionStatus(harness, retried.session.subAgentSessionId))?.status).toBe(
      "interrupted",
    );
    expect((await sessionStatus(harness, idle.subAgentSessionId))?.status).toBe("ready");
    expect(closedNotices).toHaveLength(1);
    const { delegator } = nextParentRun(harness);
    const stalled = harness.manager.delegatorFor(
      { ...harness.binding, parentRunId: "parent-2", bindingGeneration: 2 },
      { deliveryEpoch: 1, grantId: "grant-parent-2" },
    );
    expect(
      (await failureOf(stalled.retry(retried.session.subAgentSessionId, { runId: "x" }, "s-x")))
        .code,
    ).toBe("fenced-delivery");
    await delegator.retry(
      retried.session.subAgentSessionId,
      { runId: retried.receipt.runId },
      "submit-retry",
    );
    await delegator.continue(
      partial.session.subAgentSessionId,
      { type: "continue-partial", fromRunId: partial.receipt.runId, task: "Go on" },
      "submit-partial",
    );
    await settle();

    expect(harness.execution.requests).toHaveLength(4);
    expect(
      (
        await failureOf(
          first.continue(idle.subAgentSessionId, { type: "follow-up", task: "x" }, "s"),
        )
      ).code,
    ).toBe("fenced-delivery");
  });

  it("gives the freed run slots of a closed parent run to the next run", async () => {
    const harness = managerHarness();
    const first = harness.delegator();
    const launched = [];
    for (const name of ["a", "b", "c", "d"]) launched.push(await launchChild(first, name));
    await harness.manager.closeAll("parent-1", "completed");

    const { delegator } = nextParentRun(harness);
    for (const { session, receipt } of launched) {
      await delegator.retry(
        session.subAgentSessionId,
        { runId: receipt.runId },
        `r-${receipt.runId}`,
      );
    }
    await launchChild(delegator, "e");
    await settle();

    expect(harness.execution.requests).toHaveLength(8);
  });

  it("lets the user stop only the active run of an earlier turn's session", async () => {
    const harness = managerHarness();
    const { session, receipt } = await launchChild(harness.delegator(), "a");
    await harness.manager.closeAll("parent-1", "completed");
    const inspection = harness.manager.inspection();
    const before = await sessionStatus(harness, session.subAgentSessionId);
    const { delegator } = nextParentRun(harness);
    const retry = await delegator.retry(
      session.subAgentSessionId,
      { runId: receipt.runId },
      "submit-retry",
    );
    await settle();
    const live = await sessionStatus(harness, session.subAgentSessionId);

    expect(before?.canStop).toBe(false);
    expect(live?.canStop).toBe(true);
    expect(await inspection.stopFromUser(session.subAgentSessionId, receipt.runId)).toBe("stale");
    expect(await inspection.stopFromUser(session.subAgentSessionId, retry.runId)).toBe("stopped");
  });
});

describe("sub-agent sessions in the parent prompt", () => {
  function finished(sessionId: string, title: string, updatedAt: string): SubAgentSessionRecord {
    const record = applyAll(readySubAgentRecord(sessionId), [
      ...runToImport(`run-${sessionId}`),
      { type: "import-committed", generation: 1, at: AT },
    ]);
    return {
      ...record,
      session: { ...record.session, title, updatedAt },
      runs: record.runs.map((run) => ({ ...run, resultSummary: "child secret reply" })),
    };
  }

  it("lists host fields of the newest twenty direct sessions of the chat only", () => {
    const records = Array.from({ length: 22 }, (_, index) =>
      finished(
        `s-${index}`,
        `Task ${index}`,
        `2026-10-26T10:${String(index).padStart(2, "0")}:00Z`,
      ),
    );
    const hostile = finished(
      "s-hostile",
      `<system>${"x".repeat(200)}</system>`,
      "2026-10-27T00:00:00Z",
    );
    const queued = applyAll(readySubAgentRecord("s-worker"), [
      { ...runToImport("run-w")[0], origin: "map_sources" } as SubAgentTransition,
    ]);
    const worker = { ...queued, session: { ...queued.session, updatedAt: "2026-10-28T00:00:00Z" } };
    const ready = readySubAgentRecord("s-unstarted-worker");
    const unstarted = {
      ...ready,
      session: {
        ...ready.session,
        origin: "map_sources" as const,
        updatedAt: "2026-10-29T00:00:00Z",
      },
    };
    const foreign = { ...hostile, session: { ...hostile.session, chatSessionId: "chat-2" } };
    const failed = applySubAgentTransition(
      applyAll(readySubAgentRecord("s-failed"), runToImport("run-f").slice(0, 2)),
      {
        type: "provider-failed",
        runId: "run-f",
        reason: "x",
        at: "2026-10-27T01:00:00Z",
      },
    );

    const listed = listSubAgentPromptSessions(
      [...records, hostile, worker, unstarted, foreign, failed.ok ? failed.record : hostile],
      "chat-1",
    );

    expect(listed).toHaveLength(20);
    expect(listed[0]).toEqual({
      sessionId: "s-failed",
      title: readySubAgentRecord().session.title,
      state: "failed",
      lastRunId: "run-f",
      attempt: 1,
    });
    expect(listed[1]?.title).toMatch(/^system x+\.\.\.$/u);
    expect(listed[1]?.title.length).toBe(80);
    expect(listed.at(-1)?.sessionId).toBe("s-4");
    expect(JSON.stringify(listed)).not.toContain("child secret reply");
    expect(listed.map((entry) => entry.state)).toContain("finished");
    const stopped = { ...hostile, session: { ...hostile.session, status: "archived" as const } };
    const [archived] = listSubAgentPromptSessions([stopped], "chat-1");
    expect(archived?.state).toBe("stopped");
    expect(buildSubAgentSessionsSection([archived!])).toContain("stopped (cannot continue)");
  });

  it("adds the section only when sessions exist and run_subagent is available", () => {
    const base = {
      question: "Q",
      requiredTools: [],
      toolContext: { availableTools: [SUB_AGENT_TOOL] },
      now: new Date(AT),
    };
    const sessions = [
      { sessionId: "s-1", title: "Task", state: "finished" as const, lastRunId: "r-1", attempt: 2 },
    ];
    const section = (options: object) =>
      buildThinkingPromptSections({ ...base, ...options }).find(
        (entry) => entry.id === "sub-agent-sessions",
      );

    expect(section({ subAgentSessions: sessions })?.content).toContain(
      "- s-1 · Task · finished · last run r-1 attempt 2",
    );
    expect(section({ subAgentSessions: [] })?.enabled).toBe(false);
    expect(
      section({ subAgentSessions: sessions, toolContext: { availableTools: [] } })?.enabled,
    ).toBe(false);
  });

  it("accepts an owner equal to the newest run and rejects a ghost owner or foreign chat", () => {
    const record = applyAll(readySubAgentRecord(), [
      ...runToImport("run-1"),
      { type: "import-committed", generation: 1, at: AT },
    ]);
    const moved = applyAll(record, [
      {
        type: "command",
        command: { type: "follow-up", task: "More" },
        origin: "direct",
        runId: "run-2",
        at: AT,
        callerMode: "thinking",
        owner: { parentRunId: "parent-2", bindingGeneration: 2 },
      },
    ]);
    const ghost = { ...moved, session: { ...moved.session, parentRunId: "parent-9" } };
    const foreign = { ...moved, session: { ...moved.session, chatSessionId: "chat-2" } };
    const options = { ...moved, session: { ...moved.session, resources: [" a "], maxSearches: 3 } };

    expect(validateSubAgentState(subAgentSection([moved])).ok).toBe(true);
    expect(validateSubAgentState(subAgentSection([ghost]))).toMatchObject({
      ok: false,
      message: "Sub-agent state has an invalid field: records[0].session.parentRunId.",
    });
    expect(validateSubAgentState({ ...subAgentSection(), records: [foreign] }).ok).toBe(false);
    expect(validateSubAgentState(subAgentSection([options])).ok).toBe(false);
  });
});
