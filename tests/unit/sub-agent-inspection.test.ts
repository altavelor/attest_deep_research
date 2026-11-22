import { describe, expect, it } from "vitest";

import { redactSensitiveData, redactSensitiveText } from "@shared";
import {
  deriveSubAgentTitle,
  redactSubAgentJson,
  type SubAgentModelSnapshot,
  type SubAgentObservationEvent,
  type SubAgentSessionFailure,
  type SubAgentWorkflowItem,
} from "@core/research";
import { settle } from "../support/async";
import {
  AT,
  childEvidence,
  delegationGrant,
  executionResult,
  launchChild,
  managerHarness,
  managerParts,
} from "../support/subAgentSessions";

type Harness = ReturnType<typeof managerHarness>;

const MODEL_A: SubAgentModelSnapshot = {
  profileId: "profile-a",
  providerId: "openai",
  modelId: "model-a",
  label: "Model A",
};

function redactingHarness() {
  return managerHarness({ redact: redactSensitiveText });
}

function observe(harness: Harness, index: number, event: SubAgentObservationEvent): void {
  harness.execution.requests[index].onObservation(event);
}

async function card(harness: Harness, sessionId: string) {
  const snapshot = await harness.manager.inspection().snapshot();
  return snapshot.sessions.find((entry) => entry.sessionId === sessionId)!;
}

function toolItem(harness: Harness, index: number, call: string, overrides = {}) {
  const request = harness.execution.requests[index];
  return {
    id: `${request.runId}:${call}`,
    sessionId: request.sessionId,
    runId: request.runId,
    name: "search_web",
    label: `Search ${call}`,
    sequence: 0,
    round: 1,
    status: "pending",
    startedAt: "2026-10-26T10:00:00.000Z",
    payloadState: "captured",
    ...overrides,
  } as SubAgentWorkflowItem;
}

function stateText(harness: Harness): string {
  return JSON.stringify(managerParts(harness.manager).store.state);
}

async function failureOf(promise: Promise<unknown>): Promise<SubAgentSessionFailure> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error as SubAgentSessionFailure,
  );
}

describe("sub-agent inspection snapshot", () => {
  it("stores the task, title and resources redacted and replays the same submission", async () => {
    const harness = redactingHarness();
    const delegator = harness.delegator();
    const session = await delegator.create({
      createRequestId: "create-secret",
      title: "Audit password=hunter2",
      resources: ["example.org", "token=hunter2"],
    });
    const task = { type: "initial", task: "Log in with password=hunter2" } as const;
    const receipt = await delegator.run(session.subAgentSessionId, task, "submit-secret");
    await settle();

    await expect(delegator.run(session.subAgentSessionId, task, "submit-secret")).resolves.toEqual(
      receipt,
    );
    expect(stateText(harness)).not.toContain("hunter2");
    expect(stateText(harness)).toContain("example.org");
    expect(JSON.stringify(harness.writer.deltas)).not.toContain("hunter2");
    expect(harness.execution.requests[0].task).toContain("Log in with password=");
  });

  it("counts only running sessions, sorts running first and derives hasAgentRuns from accepted runs", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const idle = await delegator.create({ createRequestId: "create-idle", title: "Idle" });
    expect((await harness.manager.inspection().snapshot()).hasAgentRuns).toBe(false);
    await launchChild(delegator, "first");
    const second = await launchChild(delegator, "second");
    harness.imports.mode = "hold";
    harness.probes.now = "2026-10-26T11:00:00.000Z";
    harness.execution.finish(0);
    await settle();
    for (const name of ["c", "d", "e", "queued"]) await launchChild(delegator, name);

    const snapshot = await harness.manager.inspection().snapshot();
    expect(snapshot.activeCount).toBe(4);
    expect(snapshot.hasAgentRuns).toBe(true);
    expect(snapshot.sessions.slice(0, 4).map((entry) => entry.status)).toEqual(
      Array(4).fill("running"),
    );
    expect(snapshot.sessions[3].sessionId).toBe(second.session.subAgentSessionId);
    expect(
      snapshot.sessions
        .slice(4, 6)
        .map((entry) => entry.status)
        .sort(),
    ).toEqual(["importing", "queued"]);
    expect(snapshot.sessions[6].sessionId).toBe(idle.subAgentSessionId);
    const state = managerParts(harness.manager).store.state!;
    const trimmed = {
      ...state,
      records: state.records.map((record) => ({ ...record, runs: [] })),
    };
    const reloaded = managerHarness({ load: async () => trimmed });
    expect((await reloaded.manager.inspection().snapshot()).hasAgentRuns).toBe(true);
  });

  it("keeps the captured model per run and the title of the first task", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session } = await launchChild(delegator, "alpha", "Investigate alpha in depth");
    const model = { ...MODEL_A };
    observe(harness, 0, {
      type: "model-started",
      runId: harness.execution.requests[0].runId,
      model,
      prompt: { messages: [] } as never,
    });
    model.label = "Changed in the dropdown";
    harness.execution.finish(0);
    await settle();
    await delegator.continue(
      session.subAgentSessionId,
      { type: "follow-up", task: "Completely different words" },
      "submit-follow",
    );
    await settle();
    observe(harness, 1, {
      type: "model-started",
      runId: harness.execution.requests[1].runId,
      model: { ...MODEL_A, modelId: "model-b", label: "Model B" },
      prompt: { messages: [] } as never,
    });

    const detail = await harness.manager.inspection().getSession(session.subAgentSessionId);
    expect(detail?.runs.map((run) => run.model?.label)).toEqual(["Model A", "Model B"]);
    expect(detail?.card.model?.label).toBe("Model B");
    expect(detail?.card.description).toBe(deriveSubAgentTitle("Investigate alpha in depth"));
  });

  it("measures elapsed time on the monotonic clock without queue time or gaps", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const { session } = await launchChild(delegator, "alpha");
    const sessionId = session.subAgentSessionId;
    harness.probes.clockMs = 400;
    expect((await card(harness, sessionId)).elapsedMs).toBe(400);
    harness.execution.finish(0);
    await settle();
    harness.probes.clockMs = 90_000;
    expect((await card(harness, sessionId)).elapsedMs).toBe(400);
    await delegator.continue(sessionId, { type: "follow-up", task: "More" }, "submit-more");
    await settle();
    harness.probes.clockMs = 90_250;
    const running = await card(harness, sessionId);
    expect(running.elapsedMs).toBe(650);
    await harness.manager.inspection().stopFromUser(sessionId, running.controlRunId);
    await settle();
    harness.probes.clockMs = 99_000;
    expect((await card(harness, sessionId)).elapsedMs).toBe(650);
    const stopped = harness.mainEvents.find(
      (intent) => intent.type === "notice" && intent.entry.kind === "stopped",
    );
    expect(stopped?.entry).toMatchObject({ durationMs: 250 });
  });

  it("sums usage per request, replaces live by final and keeps unknown totals partial", async () => {
    const harness = managerHarness();
    const { session, receipt } = await launchChild(harness.delegator(), "alpha");
    const usage = (requestId: string, final: boolean, tokens: object) =>
      observe(harness, 0, {
        type: "usage",
        runId: receipt.runId,
        requestId,
        final,
        usage: {
          requestCount: 1,
          modelRounds: 1,
          toolCalls: 0,
          durationMs: 0,
          source: "provider",
          ...tokens,
        },
      });
    usage("request-1", false, { inputTokens: 10, outputTokens: 5 });
    usage("request-1", true, {
      inputTokens: 12,
      outputTokens: 6,
      reasoningTokens: 3,
      cachedInputTokens: 4,
    });
    usage("request-2", true, { inputTokens: 0, outputTokens: 0 });
    const complete = await card(harness, session.subAgentSessionId);
    expect([complete.usage.totalTokens, complete.usageIncomplete]).toEqual([18, false]);

    usage("request-3", true, { inputTokens: 7 });
    const partial = await card(harness, session.subAgentSessionId);
    expect(partial.usage).toMatchObject({ inputTokens: 19, outputTokens: 6, totalTokens: 18 });
    expect(partial.usage).toMatchObject({
      reasoningTokens: 3,
      cachedInputTokens: 4,
      requestCount: 3,
    });
    expect(partial.usageIncomplete).toBe(true);
  });

  it("captures the first request's messages redacted, bounded and with absence states", async () => {
    const harness = redactingHarness();
    const delegator = harness.delegator();
    const { session, receipt } = await launchChild(delegator, "alpha");
    const other = await launchChild(delegator, "beta");
    const detailOf = async (id: string) =>
      (await harness.manager.inspection().getSession(id))!.initialPrompts[0];
    expect((await detailOf(session.subAgentSessionId)).state).toBe("not-started");
    const filler = "x".repeat(64 * 1024 - 20);
    observe(harness, 0, {
      type: "model-started",
      runId: receipt.runId,
      model: MODEL_A,
      prompt: {
        messages: [
          { role: "system", content: "Framing" },
          { role: "user", content: `${filler} token=abcdefsecret more text` },
          { role: "assistant", content: "Never stored" },
        ],
      } as never,
    });
    observe(harness, 0, {
      type: "model-started",
      runId: receipt.runId,
      model: { ...MODEL_A, label: "Later model" },
      prompt: { messages: [{ role: "user", content: "Second request" }] } as never,
    });
    harness.execution.finish(1);
    await settle();

    const prompt = await detailOf(session.subAgentSessionId);
    expect((await card(harness, session.subAgentSessionId)).model?.label).toBe("Model A");
    expect(prompt.messages[0].content).toBe("Framing");
    expect(prompt).toMatchObject({ state: "captured", redacted: true, truncated: true });
    expect(prompt.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(prompt.messages[1].content.length).toBeLessThanOrEqual(64 * 1024 - "Framing".length);
    expect(stateText(harness)).not.toContain("abcdef");
    expect((await detailOf(other.session.subAgentSessionId)).state).toBe("unavailable");
  });

  it("updates one tool item per call, captures payloads only in debug and within both caps", async () => {
    const harness = redactingHarness();
    const { session } = await launchChild(harness.delegator(), "alpha");
    harness.probes.debug = true;
    const secretAtCallCap = `${"a".repeat(32 * 1024 - 12)} token=prefixsecret1`;
    observe(harness, 0, {
      type: "tool-start",
      item: toolItem(harness, 0, "c1", { args: { q: "z".repeat(10 * 1024) } }),
    });
    observe(harness, 0, { type: "tool-start", item: toolItem(harness, 0, "c2") });
    observe(harness, 0, {
      type: "tool-end",
      item: toolItem(harness, 0, "c1", {
        status: "failed",
        resultJson: '{"error":{"code":"web-fetch-failed"}}',
      }),
    });
    observe(harness, 0, {
      type: "tool-end",
      item: toolItem(harness, 0, "c2", { status: "complete", resultJson: secretAtCallCap }),
    });
    for (let call = 3; call <= 11; call += 1) {
      const resultJson = `${"b".repeat(30 * 1024 - 16)} token=runsecret${call}`;
      observe(harness, 0, {
        type: "tool-end",
        item: toolItem(harness, 0, `c${call}`, { status: "complete", resultJson }),
      });
    }

    const detail = await harness.manager.inspection().getSession(session.subAgentSessionId);
    const items = detail!.lifetime;
    expect(items.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(items[0]).toMatchObject({
      status: "failed",
      badge: { text: "web-fetch-failed" },
      args: { q: "z".repeat(10 * 1024) },
    });
    expect(items[1].payloadState).toBe("truncated");
    expect(items.map((item) => item.payloadState).slice(2)).toEqual([
      ...Array(8).fill("captured"),
      "truncated",
    ]);
    expect(stateText(harness)).not.toMatch(/prefixsecret|runsecret11/);
    const parts = managerParts(harness.manager);
    const c2 = parts.store.state!.observation.find((entry) => entry.observationId.endsWith(":c2"))!;
    parts.store.putObservation({ ...c2, payload: null, evicted: { reason: "chat size limit" } });
    const evicted = await harness.manager.inspection().getSession(session.subAgentSessionId);
    expect(evicted!.lifetime[1]).toMatchObject({ sequence: 2, payloadState: "evicted" });
    harness.probes.debug = false;
    const hidden = await harness.manager.inspection().getSession(session.subAgentSessionId);
    expect(hidden!.lifetime[0]).toMatchObject({ payloadState: "disabled" });
    expect(hidden!.lifetime[0].args).toBeUndefined();
  });

  it("captures no credential stored under a sensitive key in tool arguments or result JSON", async () => {
    const harness = redactingHarness();
    const { session } = await launchChild(harness.delegator(), "alpha");
    harness.probes.debug = true;
    observe(harness, 0, {
      type: "tool-end",
      item: toolItem(harness, 0, "c1", {
        status: "complete",
        args: {
          apiKey: "abc123",
          clientSecret: "cs-9",
          headers: { "x-auth": 7, password: 12345 },
          q: "news",
        },
        resultJson: '{"access_token":"tok-xyz","password":987654,"items":[1]}',
      }),
    });

    const detail = await harness.manager.inspection().getSession(session.subAgentSessionId);
    expect(detail!.lifetime[0]).toMatchObject({
      args: {
        apiKey: "[redacted]",
        clientSecret: "[redacted]",
        headers: { password: "[redacted]" },
        q: "news",
      },
      resultJson: '{"access_token":"[redacted]","password":"[redacted]","items":[1]}',
    });
    expect(stateText(harness)).not.toMatch(/abc123|cs-9|12345|tok-xyz|987654/);
  });
});

describe("sub-agent user stop", () => {
  it("matches the stop against the shown run, not against progress or a newer run", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const inspection = harness.manager.inspection();
    const running = await launchChild(delegator, "running");
    const finished = await launchChild(delegator, "finished");
    const idle = await delegator.create({ createRequestId: "create-idle", title: "Idle" });
    const before = await card(harness, running.session.subAgentSessionId);
    observe(harness, 0, {
      type: "phase",
      runId: running.receipt.runId,
      phase: "Searching",
      occurredAt: "x",
    });
    expect((await card(harness, running.session.subAgentSessionId)).revision).toBeGreaterThan(
      before.revision,
    );
    harness.execution.finish(1);
    await settle();
    await delegator.continue(
      finished.session.subAgentSessionId,
      { type: "follow-up", task: "Again" },
      "submit-again",
    );

    expect(await inspection.stopFromUser(running.session.subAgentSessionId, null)).toBe("stale");
    expect(
      await inspection.stopFromUser(running.session.subAgentSessionId, before.controlRunId),
    ).toBe("stopped");
    expect(
      await inspection.stopFromUser(running.session.subAgentSessionId, before.controlRunId),
    ).toBe("already-terminal");
    expect(
      await inspection.stopFromUser(finished.session.subAgentSessionId, finished.receipt.runId),
    ).toBe("stale");
    const stoppedCard = await card(harness, running.session.subAgentSessionId);
    observe(harness, 0, { type: "tool-end", item: toolItem(harness, 0, "late") });
    expect((await card(harness, running.session.subAgentSessionId)).revision).toBe(
      stoppedCard.revision,
    );
    expect(stateText(harness)).not.toContain(":late");
    expect(await inspection.stopFromUser(idle.subAgentSessionId, null)).toBe("already-terminal");
    const open = await launchChild(delegator, "open");
    managerParts(harness.manager).fences.revoke("parent-1");
    expect(await inspection.stopFromUser(open.session.subAgentSessionId, open.receipt.runId)).toBe(
      "already-terminal",
    );
    expect((await failureOf(inspection.stopFromUser("session-foreign", null))).error.code).toBe(
      "not-authorized",
    );
  });

  it("archives running and importing sessions, leaves idle ones and keeps the fence when the archive save fails", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const inspection = harness.manager.inspection();
    const ready = await launchChild(delegator, "ready");
    const importing = await launchChild(delegator, "importing");
    const running = await launchChild(delegator, "running");
    harness.execution.finish(0);
    await settle();
    harness.imports.mode = "hold";
    harness.execution.finish(1);
    await settle();

    expect(
      await inspection.stopFromUser(ready.session.subAgentSessionId, ready.receipt.runId),
    ).toBe("already-terminal");
    expect(
      await inspection.stopFromUser(importing.session.subAgentSessionId, importing.receipt.runId),
    ).toBe("stopped");
    harness.writer.failNext(new Error("disk full"));
    const failure = await failureOf(
      inspection.stopFromUser(running.session.subAgentSessionId, running.receipt.runId),
    );
    expect(failure.error.code).toBe("persistence-failed");
    expect(harness.execution.requests[2].signal.aborted).toBe(true);
    harness.execution.finish(2);
    await settle();
    expect(
      await inspection.stopFromUser(running.session.subAgentSessionId, running.receipt.runId),
    ).toBe("stopped");

    const state = managerParts(harness.manager).store.state!;
    expect(state.records.map((record) => record.session.status)).toEqual([
      "ready",
      "archived",
      "archived",
    ]);
    expect(
      state.imports.find((entry) => entry.runId === importing.receipt.runId)?.tombstoneReason,
    ).toBe("user-archive");
    await expect(
      delegator.continue(
        importing.session.subAgentSessionId,
        { type: "follow-up", task: "More" },
        "submit-late",
      ),
    ).rejects.toBeDefined();
  });
});

describe("sub-agent main-visible events", () => {
  it("dispatches accepted direct commands once and publishes one redacted, bounded notice per transition", async () => {
    const harness = redactingHarness();
    harness.grants.set("grant-2", delegationGrant(harness.binding, { origin: "map_sources" }));
    const delegator = harness.delegator();
    const { session, receipt } = await launchChild(delegator, "alpha");
    await delegator.run(
      session.subAgentSessionId,
      { type: "initial", task: "Investigate alpha" },
      "submit-alpha",
    );
    await launchChild(harness.delegator("grant-2"), "worker");
    observe(harness, 0, {
      type: "model-started",
      runId: receipt.runId,
      model: MODEL_A,
      prompt: {
        messages: [{ role: "assistant", content: "token=promptsecret", reasoning: "hidden chain" }],
      } as never,
    });
    const answer = `${"é".repeat(2040)} token=replysecret`;
    harness.execution.finish(0, executionResult(answer));
    await settle();

    const kinds = harness.mainEvents.map((intent) =>
      intent.type === "dispatch" ? `dispatch:${intent.entry.commandKind}` : intent.entry.kind,
    );
    expect(kinds).toEqual(["created", "dispatch:initial", "finished"]);
    const finished = harness.mainEvents[2].entry as {
      replyExcerpt: string;
      replyTruncated: boolean;
    };
    expect(finished.replyTruncated).toBe(true);
    expect(finished.replyExcerpt).toBe(`${"é".repeat(2040)} token=`);
    const parts = managerParts(harness.manager);
    parts.mainEvents.terminal(session.subAgentSessionId, receipt.runId, "finished", answer);
    parts.mainEvents.dispatch(session.subAgentSessionId, receipt.runId, "initial");
    await settle();
    expect(harness.mainEvents).toHaveLength(3);
    const detail = await harness.manager.inspection().getSession(session.subAgentSessionId);
    const visible = JSON.stringify([
      harness.mainEvents,
      detail,
      managerParts(harness.manager).store.state,
    ]);
    expect(visible).not.toMatch(/promptsecret|replysecret|replys|hidden chain/);
  });
});

describe("sub-agent inspection hardening", () => {
  it("coalesces change notifications into one snapshot and survives unsubscribing", async () => {
    const harness = managerHarness();
    const inspection = harness.manager.inspection();
    const { session, receipt } = await launchChild(harness.delegator(), "alpha");
    const seen: string[] = [];
    let stopSecond = (): void => undefined;
    const stopFirst = inspection.subscribe((snapshot) => {
      seen.push(snapshot.sessions[0].status);
      stopSecond();
    });
    stopSecond = inspection.subscribe(() => seen.push("second"));
    observe(harness, 0, { type: "phase", runId: receipt.runId, phase: "One", occurredAt: AT });
    observe(harness, 0, { type: "phase", runId: receipt.runId, phase: "Two", occurredAt: AT });
    await settle();
    expect(seen).toEqual(["running"]);
    harness.execution.finish(0);
    await settle();
    expect(seen.at(-1)).toBe("ready");
    const delivered = seen.length;
    stopFirst();
    await launchChild(harness.delegator(), "beta");
    await settle();
    expect(seen).toHaveLength(delivered);
    expect((await card(harness, session.subAgentSessionId)).status).toBe("ready");
  });

  it.each(["plugin-unload", "finalize-timeout"])(
    "publishes queued, failed, not-started, %s interrupted and closed notices once each",
    async (reason) => {
      const harness = managerHarness();
      const delegator = harness.delegator();
      const launched = [];
      for (const name of ["a", "b", "c", "d", "e"])
        launched.push(await launchChild(delegator, name));
      managerParts(harness.manager).sessionOptions.delete(launched[4].session.subAgentSessionId);
      harness.execution.fail(0);
      await settle();
      await harness.manager.closeAll("parent-empty", "completed");
      await harness.manager.closeAll("parent-1", reason);
      await harness.manager.closeAll("parent-1", reason);
      await settle();

      const notices = harness.mainEvents.flatMap((intent) =>
        intent.type === "notice" && intent.entry.kind !== "created" ? [intent.entry] : [],
      );
      expect(notices.map((entry) => entry.kind)).toEqual([
        "queued",
        "not-started",
        "failed",
        "interrupted",
        "interrupted",
        "interrupted",
        "closed",
      ]);
      expect(notices[2]).toMatchObject({ reasonCode: "provider-failed" });
      expect(notices[3]).toMatchObject({ reasonCode: reason });
      expect(notices[6]).toMatchObject({ closedCount: 3, sessionId: null });
    },
  );

  it("redacts run text in the detail and bounds untrusted result values", async () => {
    const harness = managerHarness({
      redact: (text) => {
        if (text.includes("EXPLODE")) throw new Error("redactor failed");
        return redactSensitiveData(text);
      },
    });
    const delegator = harness.delegator();
    const { session } = await launchChild(delegator, "alpha", "Check token=tasksecret now");
    const failing = await launchChild(delegator, "beta");
    let nested: Record<string, unknown> = { text: "leaf" };
    for (let depth = 0; depth < 100_000; depth += 1) nested = { child: nested };
    const cyclic: Record<string, unknown> = { id: "token=idsecret" };
    cyclic.self = cyclic;
    const evidence = [
      nested,
      cyclic,
      { meta: { id: "token=metasecret" } },
      JSON.parse('{"__proto__":{"polluted":true},"text":"t"}'),
      childEvidence("token=sk-live-SECRETID"),
      childEvidence("kept-1"),
    ];
    harness.execution.finish(0, {
      ...executionResult("Answer [token=sk-live-SECRETID] and [kept-1]"),
      evidence: evidence as never,
    });
    harness.execution.finish(1, executionResult("EXPLODE"));
    await settle();

    const detail = await harness.manager.inspection().getSession(session.subAgentSessionId);
    expect(detail!.runs[0].command).toBe("Check token=[redacted] now");
    expect(JSON.stringify(detail)).not.toContain("tasksecret");
    expect(stateText(harness)).not.toMatch(/idsecret|metasecret|SECRETID/);
    const imported = managerParts(harness.manager).store.state!.imports[0];
    expect(imported.evidence).toHaveLength(1);
    expect(imported.answerText).not.toContain("token=");
    expect(detail!.runs[0].status).toBe("completed");
    const copy = redactSubAgentJson(evidence[3], (text) => text) as Record<string, unknown>;
    expect([Object.getPrototypeOf(copy), copy.polluted]).toEqual([Object.prototype, undefined]);
    expect(redactSubAgentJson(cyclic, (text) => text).self).toBeNull();
    expect((await card(harness, failing.session.subAgentSessionId)).status).toBe("failed");
  });
});
