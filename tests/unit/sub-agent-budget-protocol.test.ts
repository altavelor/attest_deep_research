import { describe, expect, it } from "vitest";

import type { SubAgentSessionFailure } from "@core/research";
import { settle } from "../support/async";
import { subAgentSection } from "../support/chatDocuments";
import {
  applyAll,
  AT,
  budgetCoordinator,
  childEvidence,
  delegationGrant,
  executionResult,
  FakeBudgetOwner,
  launchChild,
  managerHarness,
  managerParts,
  readySubAgentRecord,
  scopedGrant,
} from "../support/subAgentSessions";

async function failureOf(promise: Promise<unknown>): Promise<SubAgentSessionFailure> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error as SubAgentSessionFailure,
  );
}

function scopedHarness(owner = new FakeBudgetOwner()) {
  const harness = managerHarness({ budget: owner });
  harness.grants.set("scope-1", scopedGrant(harness.binding, "scope-1"));
  harness.grants.set("scope-2", scopedGrant(harness.binding, "scope-2"));
  return { ...harness, owner };
}

function runningSection() {
  const record = applyAll(readySubAgentRecord("session-1"), [
    {
      type: "command",
      command: { type: "initial", task: "Find X" },
      origin: "direct",
      runId: "run-1",
      at: AT,
      callerMode: "deep-research",
    },
    { type: "scheduler-start", runId: "run-1", at: AT },
  ]);
  return subAgentSection([record]);
}

const identity = { sessionId: "session-1", runId: "run-1", attempt: 1, scopeId: "scope-1" };
const search = { action: "search", units: { searches: 1 } } as const;

describe("required-scope registration", () => {
  it("U1: binds sessions to their trusted scope owner and never falls back to local", async () => {
    const unported = managerHarness();
    unported.grants.set("scoped", scopedGrant(unported.binding));
    unported.grants.set(
      "instant",
      delegationGrant(unported.binding, {
        callerMode: "instant",
        budgetPolicy: { type: "required-scope", scopeId: "scope-1" },
      }),
    );
    const harness = scopedHarness();
    harness.grants.set(
      "instant",
      delegationGrant(harness.binding, {
        callerMode: "instant",
        budgetPolicy: { type: "required-scope", scopeId: "scope-1" },
      }),
    );

    const noPort = await failureOf(
      unported.delegator("scoped").create({ createRequestId: "c", title: "T" }),
    );
    const spoofedMode = await failureOf(
      harness.delegator("instant").create({ createRequestId: "c", title: "T" }),
    );
    const first = await launchChild(harness.delegator("scope-1"), "a");
    const second = await launchChild(harness.delegator("scope-2"), "b");
    const foreign = await failureOf(
      harness
        .delegator("scope-2")
        .continue(first.session.subAgentSessionId, { type: "follow-up", task: "x" }, "s-x"),
    );
    await settle();

    expect([noPort.code, spoofedMode.code, foreign.code]).toEqual(Array(3).fill("not-authorized"));
    expect(first.session.budgetPolicy).toEqual({ type: "required-scope", scopeId: "scope-1" });
    expect([...harness.owner.permits.values()].map((permit) => permit.scopeId)).toEqual([
      "scope-1",
      "scope-2",
    ]);
    expect(harness.execution.requests.map((request) => request.sessionId)).toEqual([
      first.session.subAgentSessionId,
      second.session.subAgentSessionId,
    ]);
  });

  it("U2: joins a pending registration and returns the session only after an accepted finish", async () => {
    const harness = scopedHarness();
    const releaseBegin = harness.owner.hold("beginSessionRegistration");
    const releaseFinish = harness.owner.hold("finishSessionRegistration");
    const delegator = harness.delegator("scope-1");
    let created = false;

    const first = delegator.create({ createRequestId: "create-a", title: "Task" });
    void first.then(
      () => (created = true),
      () => undefined,
    );
    await settle();
    const replay = delegator.create({ createRequestId: "create-a", title: "Task" });
    const conflict = await failureOf(
      delegator.create({ createRequestId: "create-a", title: "Other" }),
    );
    releaseBegin();
    await settle();
    const beforeFinish = created;
    harness.probes.epoch = 2;
    releaseFinish();
    const staleCodes = [(await failureOf(first)).code, (await failureOf(replay)).code];
    const restored = await harness.delegator("scope-1", 2).getCreatedSession("create-a");

    expect(beforeFinish).toBe(false);
    expect(staleCodes).toEqual(["fenced-delivery", "fenced-delivery"]);
    expect(restored.subAgentSessionId).toBe("subagent-session-chat-1-1");
    expect(conflict.code).toBe("idempotency-conflict");
    expect(harness.owner.calls.filter((call) => call.startsWith("begin"))).toEqual([
      "beginSessionRegistration:create-a",
    ]);
  });

  it("U3: a seal denies later registrations and an earlier one still finishes without a usable session", async () => {
    const harness = scopedHarness();
    const releaseBegin = harness.owner.hold("beginSessionRegistration");
    const delegator = harness.delegator("scope-1");

    const preSeal = failureOf(delegator.create({ createRequestId: "create-a", title: "Task" }));
    await settle();
    harness.owner.seal("scope-1");
    releaseBegin();
    const sealed = await preSeal;
    const postSeal = await failureOf(
      delegator.create({ createRequestId: "create-b", title: "Task" }),
    );
    const replayed = await failureOf(
      delegator.create({ createRequestId: "create-b", title: "Task" }),
    );
    const closedReplay = await failureOf(
      delegator.create({ createRequestId: "create-a", title: "Task" }),
    );
    const published = harness.manager.listRunRefs("parent-1");

    expect([sealed.code, postSeal.code, replayed.code, closedReplay.code]).toEqual(
      Array(4).fill("budget-denied"),
    );
    expect(harness.owner.calls).toContain("finishSessionRegistration:create-a:published");
    expect(harness.owner.calls).not.toContain("finishSessionRegistration:create-b:published");
    expect(harness.owner.scope("scope-1").registrations.size).toBe(0);
    expect(published).toEqual([]);
  });
});

describe("required-scope execution permits", () => {
  it("U4: takes one execution permit per run and keeps metering keys stable across reload", async () => {
    const harness = scopedHarness();
    const releaseStart = harness.owner.hold("markStarted");
    const { session, receipt } = await launchChild(harness.delegator("scope-1"), "a");
    await settle();
    const runnerBeforeStart = harness.execution.requests.length;
    releaseStart();
    await settle();
    harness.execution.finish(0);
    await settle();
    const owner = new FakeBudgetOwner();
    const first = await budgetCoordinator(owner, runningSection());
    const current = (): boolean => true;

    await first.coordinator.meter(identity, search, current, async () => "one");
    await first.coordinator.meter(identity, search, current, async () => "two");
    const reloaded = await budgetCoordinator(owner, first.store.state!);
    await reloaded.coordinator.meter(identity, search, current, async () => "three");
    await reloaded.coordinator.meter(
      identity,
      { action: "fetch", units: {} },
      current,
      async () => 0,
    );

    expect(runnerBeforeStart).toBe(0);
    expect([...harness.owner.settlements.values()]).toEqual(["consumed"]);
    expect(harness.owner.calls.filter((call) => call.startsWith("beginExecution"))).toEqual([
      `beginExecution:${session.subAgentSessionId}:${receipt.runId}:1:execution:0`,
    ]);
    expect(owner.calls.filter((call) => call.startsWith("reserve"))).toEqual([
      "reserve:session-1:run-1:1:search:0",
      "reserve:session-1:run-1:1:search:1",
      "reserve:session-1:run-1:1:search:2",
      "reserve:session-1:run-1:1:fetch:0",
    ]);
  });

  it("U5: marks the permit started before the side effect and never contacts it when the start fails", async () => {
    const owner = new FakeBudgetOwner();
    const { coordinator } = await budgetCoordinator(owner, runningSection());
    const sideEffect = async (): Promise<void> => void owner.calls.push("side-effect");

    await coordinator.meter(identity, search, () => true, sideEffect);
    owner.failNext("markStarted");
    const failed = await failureOf(coordinator.meter(identity, search, () => true, sideEffect));
    await settle();

    expect(owner.calls).toEqual([
      "reserve:session-1:run-1:1:search:0",
      "markStarted:session-1:run-1:1:search:0",
      "side-effect",
      "settle:session-1:run-1:1:search:0:consumed",
      "reserve:session-1:run-1:1:search:1",
      "markStarted:session-1:run-1:1:search:1",
      "settle:session-1:run-1:1:search:1:consumed",
    ]);
    expect(failed.code).toBe("budget-port-error");
  });

  it("U6: a stop before start returns the permit and a stop after start consumes it without the side effect", async () => {
    const owner = new FakeBudgetOwner();
    const { coordinator, store } = await budgetCoordinator(owner, runningSection());
    const sideEffect = async (): Promise<void> => void owner.calls.push("side-effect");

    const releaseReserve = owner.hold("reserve");
    const beforeStart = failureOf(coordinator.meter(identity, search, () => true, sideEffect));
    await settle();
    coordinator.fence("session-1");
    releaseReserve();
    const releaseStart = owner.hold("markStarted");
    const afterStart = failureOf(coordinator.meter(identity, search, () => true, sideEffect));
    await settle();
    coordinator.fence("session-1");
    releaseStart();
    const codes = [(await beforeStart).code, (await afterStart).code];
    await settle();
    const replayed = await budgetCoordinator(owner, store.state!);
    await owner.settle(owner.permits.get("session-1:run-1:1:search:0")!, "consumed");

    expect(codes).toEqual(["fenced-delivery", "fenced-delivery"]);
    expect(owner.calls).not.toContain("side-effect");
    expect([...owner.settlements.values()]).toEqual(["not-started", "consumed"]);
    expect(replayed.store.state!.pendingActions.map((action) => action.outcome)).toEqual([
      { settlement: "not-started" },
      { settlement: "consumed" },
    ]);
  });
});

describe("required-scope denial and cleanup", () => {
  it("U7: a work denial fails only its run, keeps its denial id and opens no closure", async () => {
    const harness = scopedHarness();
    const delegator = harness.delegator("scope-1");
    const denied = await delegator.create({ createRequestId: "create-a", title: "A" });
    harness.owner.deniedWork.add(`${denied.subAgentSessionId}:subagent-run-chat-1-2:1:execution:0`);

    const receipt = await delegator.run(
      denied.subAgentSessionId,
      { type: "initial", task: "A" },
      "submit-a",
    );
    const neighbour = await launchChild(delegator, "b");
    await settle();

    expect(receipt.runId).toBe("subagent-run-chat-1-2");
    expect(await delegator.getResult(denied.subAgentSessionId, receipt.runId)).toMatchObject({
      state: "failed",
    });
    expect(harness.execution.requests.map((request) => request.runId)).toEqual([
      neighbour.receipt.runId,
    ]);
    expect(harness.owner.calls.some((call) => call.startsWith("claim"))).toBe(false);
    expect(harness.owner.scope("scope-1").closure).toBeNull();
  });

  it("U8: concurrent global denials elect one cleanup owner that terminates the whole scope only", async () => {
    const harness = scopedHarness();
    harness.owner.scope("scope-1").executionsLeft = 1;
    const running = await launchChild(harness.delegator("scope-1"), "running");
    const neighbour = await launchChild(harness.delegator("scope-2"), "neighbour");
    await settle();

    const late = await Promise.all([
      launchChild(harness.delegator("scope-1"), "a"),
      launchChild(harness.delegator("scope-1"), "b"),
    ]);
    await settle();
    const delegator = harness.delegator("scope-1");
    const states = await Promise.all(
      [running, ...late].map(({ session, receipt }) =>
        delegator.getResult(session.subAgentSessionId, receipt.runId),
      ),
    );

    harness.execution.finish(0);
    await settle();

    expect(states.map((state) => state.state)).toEqual(["interrupted", "failed", "failed"]);
    expect([...harness.owner.settlements.values()]).toEqual(["consumed"]);
    expect(harness.owner.calls.filter((call) => call.startsWith("claim"))).toEqual([
      "claimClosureCleanup:closure-scope-1",
      "claimClosureCleanup:closure-scope-1",
    ]);
    expect(harness.execution.requests[0].signal.aborted).toBe(true);
    expect(harness.execution.requests[1].sessionId).toBe(neighbour.session.subAgentSessionId);
    expect(harness.execution.requests[1].signal.aborted).toBe(false);
    const stopped = harness.mainEvents.flatMap((intent) =>
      intent.type === "notice" && intent.entry.kind === "stopped" ? [intent.entry] : [],
    );
    expect(stopped.map((entry) => [entry.runId, entry.reasonCode])).toEqual([
      [running.receipt.runId, "budget-denied"],
    ]);
  });

  it("U8 (metered): a closure first met by an evidence append stops the rest of the scope", async () => {
    const harness = scopedHarness();
    await launchChild(harness.delegator("scope-1"), "first");
    await launchChild(harness.delegator("scope-1"), "sibling");
    await settle();
    harness.owner.seal("scope-1");

    harness.execution.finish(0, { ...executionResult(), evidence: [childEvidence("e1")] });
    await settle();

    expect(harness.owner.calls.some((call) => call.startsWith("reserve:"))).toBe(true);
    expect(harness.owner.calls).toContain("claimClosureCleanup:closure-scope-1");
    expect(harness.execution.requests[1].signal.aborted).toBe(true);
  });

  it("U9 (disposed claim): a claim settling after dispose or asked after it cleans nothing up", async () => {
    const harness = scopedHarness();
    harness.owner.seal("scope-1");
    const { budget } = managerParts(harness.manager);
    const release = harness.owner.hold("claimClosureCleanup");
    const during = budget.claimCleanup("scope-1", "closure-scope-1");
    await settle();

    await harness.manager.dispose();
    release();
    const after = await budget.claimCleanup("scope-1", "closure-scope-1");

    expect([await during, after]).toEqual([false, false]);
    expect(harness.owner.calls.filter((call) => call.startsWith("claim"))).toHaveLength(1);
  });

  it("U5: a grant whose start transition no longer applies returns the permit and the slot", async () => {
    const harness = scopedHarness();
    for (const name of ["a", "b", "c"]) await launchChild(harness.delegator("scope-1"), name);
    const releaseGrant = harness.owner.hold("beginExecution");
    const { session, receipt } = await launchChild(harness.delegator("scope-1"), "d");
    await settle();
    const { store } = managerParts(harness.manager);
    const record = store.record(session.subAgentSessionId)!;
    store.putRecord({
      ...record,
      runs: record.runs.map((run) =>
        run.subAgentRunId === receipt.runId ? { ...run, status: "running" as const } : run,
      ),
    });

    releaseGrant();
    await settle();
    await launchChild(harness.delegator("scope-1"), "e");
    await settle();

    expect([...harness.owner.settlements.values()]).toEqual(["not-started"]);
    expect(harness.execution.requests.map((request) => request.task)).toEqual([
      "Investigate a",
      "Investigate b",
      "Investigate c",
      "Investigate e",
    ]);
  });

  it("U9: hung budget promises never block stop, close or dispose and a late grant is returned", async () => {
    const harness = scopedHarness();
    const releaseGrant = harness.owner.hold("beginExecution");
    const { session } = await launchChild(harness.delegator("scope-1"), "a");
    await settle();

    await harness.delegator("scope-1").stop(session.subAgentSessionId);
    const closed = await harness.manager.closeAll("parent-1", "done");
    await harness.manager.dispose();
    releaseGrant();
    await settle();

    expect(closed.unsettledPermits).toBe(1);
    expect(harness.execution.requests).toEqual([]);
    expect([...harness.owner.settlements.values()]).toEqual(["not-started"]);
  });

  it("U9 (late grant window): a close in any turn before the runner settles the permit once and never runs", async () => {
    const leaks: string[] = [];
    let windows = 0;
    for (const method of ["beginExecution", "markStarted"] as const) {
      for (let turns = 0; turns < 12; turns += 1) {
        const harness = scopedHarness();
        const release = harness.owner.hold(method);
        await launchChild(harness.delegator("scope-1"), "a");
        await settle();
        release();
        for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
        if (harness.execution.requests.length > 0) break;
        void harness.manager.closeAll("parent-1", "done");
        await settle();
        const expected = harness.owner.started.size > 0 ? "consumed" : "not-started";
        const settles = harness.owner.calls.filter((call) => call.startsWith("settle:"));
        windows += 1;
        if (
          harness.execution.requests.length !== 0 ||
          settles.length !== 1 ||
          !settles[0].endsWith(`:${expected}`)
        ) {
          leaks.push(`${method}:${turns}:${settles.join()}`);
        }
      }
    }

    expect(windows).toBeGreaterThan(2);
    expect(leaks).toEqual([]);
  });

  it("U10: invalid units and a port rejection fail explicitly without a local bypass", async () => {
    const owner = new FakeBudgetOwner();
    const { coordinator } = await budgetCoordinator(owner, runningSection());
    const harness = scopedHarness();
    harness.owner.failNext("beginExecution");
    const invalid = await Promise.all(
      [{ pages: 1 }, { searches: Number.NaN }, { searches: -1 }].map((units) =>
        failureOf(
          coordinator.meter(
            identity,
            { action: "search", units } as never,
            () => true,
            async () => 1,
          ),
        ),
      ),
    );

    const { session, receipt } = await launchChild(harness.delegator("scope-1"), "a");
    await settle();
    const result = await harness
      .delegator("scope-1")
      .getResult(session.subAgentSessionId, receipt.runId);

    expect(invalid.map((failure) => failure.code)).toEqual(Array(3).fill("invalid-input"));
    expect(owner.calls).toEqual([]);
    expect(result).toMatchObject({ state: "failed" });
    expect(harness.execution.requests).toEqual([]);
    expect([...harness.owner.settlements.values()]).toEqual(["not-started"]);
  });
});
