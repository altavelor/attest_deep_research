import { describe, expect, it, vi } from "vitest";

import { ChatStorageError } from "@application/ports";
import { waitForRunResults } from "@application/use-cases/sub-agent/waitForResults";
import type { SubAgentResultState, SubAgentSessionFailure } from "@core/research";
import { settle } from "../support/async";
import { subAgentSection } from "../support/chatDocuments";
import {
  deferred,
  executionResult,
  launchChild,
  managerHarness,
  delegationGrant,
  readySubAgentRecord,
} from "../support/subAgentSessions";
import { runPastDeadline } from "../support/timers";

vi.mock("@shared", async (importOriginal) => {
  const { withGlobalTimers } = await import("../support/timers");
  return withGlobalTimers(await importOriginal<typeof import("@shared")>());
});

function foreignParent(harness: ReturnType<typeof managerHarness>) {
  return { ...harness.binding, parentRunId: "parent-2" };
}

function foreignDelegator(harness: ReturnType<typeof managerHarness>) {
  const binding = foreignParent(harness);
  harness.grants.set("grant-2", delegationGrant(binding));
  return harness.manager.delegatorFor(binding, { deliveryEpoch: 1, grantId: "grant-2" });
}

async function failureOf(promise: Promise<unknown>): Promise<SubAgentSessionFailure> {
  const failure = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error as SubAgentSessionFailure,
  );
  return failure;
}

describe("SubAgentSessionManager ownership", () => {
  it("U1: keeps sessions, queues and cleanup of two chat managers apart", async () => {
    const first = managerHarness();
    const second = managerHarness({ chatId: "chat-2" });
    for (const name of ["a", "b", "c", "d"]) await launchChild(first.delegator(), name);
    const { session, receipt } = await launchChild(second.delegator(), "own");

    const foreign = await failureOf(
      first.delegator().getResult(session.subAgentSessionId, receipt.runId),
    );
    await first.manager.dispose();

    expect(foreign.code).toBe("not-authorized");
    expect(second.execution.requests.map((request) => request.task)).toEqual(["Investigate own"]);
    expect(second.execution.requests[0].signal.aborted).toBe(false);
    expect(first.execution.requests.every((request) => request.signal.aborted)).toBe(true);
  });

  it.each([
    [
      "an unknown grant on a stale epoch",
      (h: ReturnType<typeof managerHarness>) => h.delegator("forged", 0),
    ],
    [
      "a non-Thinking caller mode",
      (h: ReturnType<typeof managerHarness>) => {
        h.grants.set("instant", delegationGrant(h.binding, { callerMode: "instant" }));
        return h.delegator("instant");
      },
    ],
    [
      "a grant of another parent run",
      (h: ReturnType<typeof managerHarness>) => {
        h.grants.set("other", delegationGrant({ ...h.binding, parentRunId: "parent-2" }));
        return h.delegator("other");
      },
    ],
    [
      "a newer parent generation",
      (h: ReturnType<typeof managerHarness>) => {
        h.probes.parent = { ...h.binding, bindingGeneration: 2 };
        return h.delegator();
      },
    ],
  ])("U2: rejects %s as not-authorized before any allocation", async (_name, facade) => {
    const harness = managerHarness();

    const failure = await failureOf(
      facade(harness).create({ createRequestId: "create-x", title: "Task" }),
    );

    expect(failure.code).toBe("not-authorized");
    expect(harness.writer.deltas).toEqual([]);
  });

  it("U2: fences a stale delivery epoch and ignores model claims on create", async () => {
    const harness = managerHarness();
    const claims = {
      createRequestId: "create-x",
      title: "Task",
      callerMode: "deep-research",
      budgetPolicy: { type: "required-scope", scopeId: "s" },
    };

    const session = await harness.delegator().create(claims);
    harness.probes.epoch = 2;
    const stale = await failureOf(harness.delegator("grant-1", 1).getCreatedSession("create-x"));
    const restored = await harness.delegator("grant-1", 2).getCreatedSession("create-x");

    expect(session.budgetPolicy).toEqual({ type: "local" });
    expect(stale.code).toBe("fenced-delivery");
    expect(restored.subAgentSessionId).toBe(session.subAgentSessionId);
  });
});

describe("SubAgentSessionManager idempotency", () => {
  it("U3: joins a pending create and conflicts on a different input", async () => {
    const harness = managerHarness();
    const release = harness.writer.holdNext();
    const delegator = harness.delegator();

    const first = delegator.create({ createRequestId: "create-1", title: "Task" });
    const joined = delegator.create({ createRequestId: "create-1", title: "Task" });
    await settle();
    const conflict = await failureOf(
      delegator.create({ createRequestId: "create-1", title: "Other" }),
    );
    release();

    expect((await joined).subAgentSessionId).toBe((await first).subAgentSessionId);
    harness.probes.parent = foreignParent(harness);
    const foreign = await failureOf(
      foreignDelegator(harness).create({ createRequestId: "create-1", title: "Other" }),
    );
    expect(conflict.code).toBe("idempotency-conflict");
    expect(foreign.code).toBe("not-authorized");
    expect(harness.writer.deltas.filter((delta) => delta.entity === "session")).toHaveLength(1);
  });

  it("U3: replays a submission receipt and conflicts without a second run", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session, receipt } = await launchChild(delegator, "a", "Same task");

    const replay = await delegator.run(
      session.subAgentSessionId,
      { type: "initial", task: "Same task" },
      "submit-a",
    );
    const conflict = await failureOf(
      delegator.run(session.subAgentSessionId, { type: "initial", task: "Other" }, "submit-a"),
    );

    harness.probes.parent = foreignParent(harness);
    const foreignFacade = foreignDelegator(harness);
    const foreignSession = await foreignFacade.create({ createRequestId: "create-f", title: "F" });
    const foreign = await failureOf(
      foreignFacade.run(
        foreignSession.subAgentSessionId,
        { type: "initial", task: "Other" },
        "submit-a",
      ),
    );
    expect(replay).toEqual(receipt);
    expect(conflict.code).toBe("idempotency-conflict");
    expect(foreign.error.message).toBe("Нет доступа к сессии.");
    expect(harness.execution.requests).toHaveLength(1);
  });
});

describe("SubAgentSessionManager queue", () => {
  it("U4: runs four children at once in FIFO order without resources for queued ones", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    for (const name of ["a", "b", "c", "d", "e"]) await launchChild(delegator, name);
    const started = harness.execution.requests.map((request) => request.task);

    harness.execution.fail(1);
    await settle();

    expect(started).toEqual(["Investigate a", "Investigate b", "Investigate c", "Investigate d"]);
    expect(harness.execution.requests[4].task).toBe("Investigate e");
  });

  it("U4: refuses a second command while the session still has one in flight", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session } = await launchChild(delegator, "a");

    const second = await failureOf(
      delegator.continue(session.subAgentSessionId, { type: "follow-up", task: "More" }, "s-2"),
    );

    const record = readySubAgentRecord("restored");
    const local = { ...record, session: { ...record.session, budgetPolicy: { type: "local" } } };
    const restored = managerHarness({
      load: async () => subAgentSection([local as typeof record]),
    });
    const denied = await restored
      .delegator()
      .run("restored", { type: "initial", task: "Task" }, "s-restored");
    await settle();

    expect(second.code).toBe("invalid-state");
    expect(restored.execution.requests).toEqual([]);
    expect(await restored.delegator().getResult("restored", denied.runId)).toMatchObject({
      state: "failed",
      error: { code: "execution-denied" },
    });
  });

  it("U5: gives no receipt when acceptance cannot be persisted", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const session = await delegator.create({ createRequestId: "create-a", title: "Task" });
    harness.writer.failNext(new ChatStorageError("file-too-large", "too large"));

    const failure = await failureOf(
      delegator.run(session.subAgentSessionId, { type: "initial", task: "Task" }, "submit-a"),
    );
    await settle();

    expect(failure.error).toMatchObject({
      code: "persistence-failed",
      details: { storageCode: "file-too-large" },
    });
    expect(harness.execution.requests).toEqual([]);
  });

  it("U5: returns the receipt before the child ends and reports a runner error as a result", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session, receipt } = await launchChild(delegator, "a");
    const before = await delegator.getResult(session.subAgentSessionId, receipt.runId);

    harness.execution.fail(0);
    await settle();
    const after = await delegator.getResult(session.subAgentSessionId, receipt.runId);

    expect(before.state).toBe("pending");
    expect(after).toMatchObject({ state: "failed", error: { code: "provider-failed" } });
    expect(JSON.stringify(after)).not.toContain("secret");
  });

  it("U5: fails a completed run whose result cannot be saved instead of leaving it importing", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { receipt } = await launchChild(delegator, "a");
    harness.writer.failNext(new ChatStorageError("file-too-large", "too large"));

    harness.execution.finish(0);
    await settle();

    expect(await delegator.getResult(receipt.sessionId, receipt.runId)).toMatchObject({
      state: "failed",
      error: { code: "import-failed" },
    });
    expect(harness.imports.requests).toEqual([]);

    const raced = await launchChild(delegator, "b");
    harness.imports.mode = "hold";
    harness.execution.finish(1);
    await settle();
    const release = harness.writer.holdNext();
    harness.writer.failNext(new ChatStorageError("file-too-large", "too large"));
    harness.imports.release();
    await settle();
    const closing = harness.manager.closeAll("parent-1", "failed");
    await settle();
    release();
    await closing;
    await settle();
    const sessionWrites = harness.writer.deltas.filter(
      (delta) => delta.entity === "session" && delta.id === raced.receipt.sessionId,
    );
    expect(sessionWrites.at(-1)).toMatchObject({ fields: { status: "archived" } });
  });

  it("U6: passes lineage-specific bounded context to follow-up, retry and partial runs", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session } = await launchChild(delegator, "a");
    const id = session.subAgentSessionId;
    harness.execution.finish(0, executionResult("First answer"));
    await settle();
    const followUp = await delegator.continue(id, { type: "follow-up", task: "Next" }, "s-2");
    harness.execution.fail(1);
    await settle();
    const retry = await delegator.retry(id, { runId: followUp.runId }, "s-3");
    harness.imports.mode = "fail";
    harness.execution.finish(2, executionResult("x".repeat(9000)));
    await settle();
    await delegator.continue(
      id,
      { type: "continue-partial", task: "Finish it", fromRunId: retry.runId },
      "s-4",
    );

    const contexts = harness.execution.requests.map((request) => request.priorContext);
    expect(contexts[0]).toEqual({
      summary: null,
      previousResult: null,
      partialSummary: null,
      continuesPartial: false,
      priorEvidence: [],
      priorEvidenceItems: [],
    });
    expect(contexts[1]).toMatchObject({ summary: "First answer", previousResult: "First answer" });
    expect(contexts[2]).toMatchObject({ previousResult: null, partialSummary: null });
    expect(contexts[3].partialSummary).toHaveLength(1000);
    expect(contexts.map((context) => context.continuesPartial)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(harness.execution.requests[1].limits).toEqual({
      maxRounds: 6,
      maxResultChars: 4000,
      maxSearches: 5,
    });
  });
});

describe("SubAgentSessionManager stop", () => {
  it("U7: stops a queued run without ever starting its runner", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    for (const name of ["a", "b", "c", "d"]) await launchChild(delegator, name);
    const { session, receipt } = await launchChild(delegator, "e");

    await delegator.stop(session.subAgentSessionId);
    harness.execution.finish(0);
    await settle();

    expect(harness.execution.requests.map((request) => request.task)).not.toContain(
      "Investigate e",
    );
    expect(await delegator.getResult(session.subAgentSessionId, receipt.runId)).toMatchObject({
      state: "interrupted",
      error: { code: "stopped" },
    });
  });

  it("U7: drops the late outcome of a runner that ignored its abort", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session, receipt } = await launchChild(delegator, "a");

    await delegator.stop(session.subAgentSessionId);
    harness.execution.finish(0);
    await settle();

    const second = await launchChild(delegator, "b");
    harness.imports.mode = "hold";
    const timers = await runPastDeadline(0, async () => {
      harness.execution.finish(1);
      await settle();
      await delegator.stop(second.session.subAgentSessionId);
      return vi.getTimerCount();
    });

    expect(timers).toBe(0);
    expect(harness.execution.requests[0].signal.aborted).toBe(true);
    expect(harness.imports.requests.map((request) => request.runId)).toEqual([
      second.receipt.runId,
    ]);
    expect((await delegator.getResult(session.subAgentSessionId, receipt.runId)).state).toBe(
      "interrupted",
    );
  });
});

describe("SubAgentSessionManager close barrier", () => {
  it("U8: fences parent-owned work synchronously and rejects pending promises", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session, receipt } = await launchChild(delegator, "a");
    const waiting = delegator.waitForResults(
      [{ sessionId: session.subAgentSessionId, runId: receipt.runId }],
      {
        mode: "any",
        timeoutMs: 30_000,
      },
    );
    const waitingFailure = failureOf(waiting);
    await settle();

    const closing = harness.manager.closeAll("parent-1", "completed");
    const abortedBeforeAwait = harness.execution.requests[0].signal.aborted;

    expect(abortedBeforeAwait).toBe(true);
    expect((await waitingFailure).code).toBe("fenced-delivery");
    expect(await closing).toMatchObject({ durable: true, recoveryMarkerPersisted: false });
    const deltas = harness.writer.deltas.length;
    expect(await harness.manager.closeAll("parent-1", "completed")).toMatchObject({
      durable: true,
    });
    expect(harness.writer.deltas).toHaveLength(deltas);
  });

  it("U9: writes the recovery marker in the reserved budget when the drain hangs", async () => {
    const harness = managerHarness();
    await launchChild(harness.delegator(), "a");
    harness.writer.holdNext();

    const { result, timers } = await runPastDeadline(1_500, async () => ({
      result: await harness.manager.closeAll("parent-1", "failed"),
      timers: vi.getTimerCount(),
    }));

    expect(timers).toBe(0);
    expect(result).toEqual({
      durable: true,
      recoveryMarkerPersisted: true,
      unsettledPermits: 0,
      failures: ["primary-drain-timeout"],
    });
    expect(harness.writer.deltas.at(-1)).toMatchObject({ entity: "marker", id: "parent-1" });
  });

  it("U9: ends within one shared deadline when load, drain and marker all hang", async () => {
    const harness = managerHarness({ load: () => deferred<null>().promise });
    harness.writer.holdNext();

    const result = await runPastDeadline(2_000, () =>
      harness.manager.closeAll("parent-1", "failed"),
    );

    expect(result).toEqual({
      durable: false,
      recoveryMarkerPersisted: false,
      unsettledPermits: 0,
      failures: ["primary-drain-timeout", "recovery-marker-timeout"],
    });
  });

  it("U10: dispose releases controllers, listeners and waits once and ignores late results", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session, receipt } = await launchChild(delegator, "a");
    const listener = vi.fn();
    harness.manager.subscribeResults(listener);
    const waiting = delegator.waitForResults(
      [{ sessionId: session.subAgentSessionId, runId: receipt.runId }],
      {
        mode: "all",
        timeoutMs: 30_000,
      },
    );
    const waitingFailure = failureOf(waiting);
    await settle();
    const deltasBefore = harness.writer.deltas.length;

    const disposal = harness.manager.dispose();
    harness.execution.finish(0);
    await settle();

    expect(harness.manager.dispose()).toBe(disposal);
    expect(harness.execution.requests[0].signal.aborted).toBe(true);
    expect((await waitingFailure).code).toBe("fenced-delivery");
    expect(harness.writer.deltas).toHaveLength(deltasBefore);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("SubAgentSessionManager wait", () => {
  it("U11: counts only requested terminal runs and keeps an importing run pending", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const done = await launchChild(delegator, "a");
    const importing = await launchChild(delegator, "b");
    const other = await launchChild(delegator, "c");
    harness.execution.finish(0);
    await settle();
    harness.imports.mode = "hold";
    harness.execution.finish(1);
    harness.execution.fail(2);
    await settle();
    const refs = [done, importing].map(({ receipt }) => ({
      sessionId: receipt.sessionId,
      runId: receipt.runId,
    }));

    const any = await delegator.waitForResults(refs, { mode: "any", timeoutMs: 0 });
    const all = await delegator.waitForResults(refs, { mode: "all", timeoutMs: 0 });

    expect(any).toEqual({ ready: [refs[0]], timedOut: false });
    const release = harness.writer.holdNext();
    harness.writer.failNext(new ChatStorageError("file-too-large", "too large"));
    harness.imports.release();
    await settle();
    const committing = await delegator.getResult(refs[1].sessionId, refs[1].runId);
    release();
    await settle();
    const unsaved = await delegator.getResult(refs[1].sessionId, refs[1].runId);

    expect(all).toEqual({ ready: [refs[0]], timedOut: true });
    expect(other.receipt.runId).not.toBe(refs[0].runId);
    expect(committing).toMatchObject({ state: "pending", run: { resultSummary: null } });
    expect(unsaved).toMatchObject({ state: "failed", error: { code: "import-failed" } });
    expect(JSON.stringify(unsaved)).not.toContain("Child answer");
  });

  it("U11: resolves on the result signal that follows the snapshot", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { receipt } = await launchChild(delegator, "a");

    const waiting = delegator.waitForResults([receipt], { mode: "all", timeoutMs: 30_000 });
    await settle();
    harness.execution.finish(0);

    expect(await waiting).toEqual({ ready: [receipt], timedOut: false });
  });

  it("U12: a timed-out or cancelled wait removes its timer and leaves the child running", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { receipt } = await launchChild(delegator, "a");
    const controller = new AbortController();

    const timedOut = await runPastDeadline(100, async () => {
      const result = await delegator.waitForResults([receipt], { mode: "any", timeoutMs: 100 });
      return { result, timers: vi.getTimerCount() };
    });
    const cancelled = delegator.waitForResults([receipt], {
      mode: "any",
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    await settle();
    controller.abort(new Error("parent cancelled"));

    const listeners = new Set<() => void>();
    const immediate = await waitForRunResults(
      {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        read: () => ({ state: "pending" }) as SubAgentResultState,
      },
      [receipt],
      { mode: "any", timeoutMs: 0 },
      new AbortController().signal,
    );

    expect(immediate.timedOut).toBe(true);
    expect(listeners.size).toBe(0);
    expect(timedOut).toEqual({ result: { ready: [], timedOut: true }, timers: 0 });
    await expect(cancelled).rejects.toThrow("parent cancelled");
    expect(harness.execution.requests[0].signal.aborted).toBe(false);
  });
});
