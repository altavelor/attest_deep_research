import { describe, expect, it } from "vitest";

import { redactSensitiveData } from "@shared";
import {
  deriveSubAgentTitle,
  type SubAgentModelSnapshot,
  type SubAgentObservationEvent,
  type SubAgentSessionFailure,
  type SubAgentWorkflowItem,
} from "@core/research";
import { settle } from "../support/async";
import {
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
  return managerHarness({ redact: (text) => redactSensitiveData(text) });
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
  it("counts only running sessions, sorts running first and derives hasAgentRuns from accepted runs", async () => {
    const harness = managerHarness();
    const delegator = harness.delegator();
    const idle = await delegator.create({ createRequestId: "create-idle", title: "Idle" });
    expect((await harness.manager.inspection().snapshot()).hasAgentRuns).toBe(false);
    const first = await launchChild(delegator, "first");
    const second = await launchChild(delegator, "second");
    harness.imports.mode = "hold";
    harness.execution.finish(0);
    await settle();

    const snapshot = await harness.manager.inspection().snapshot();
    expect(snapshot.activeCount).toBe(1);
    expect(snapshot.hasAgentRuns).toBe(true);
    const rest = [first.session.subAgentSessionId, idle.subAgentSessionId].sort();
    expect(snapshot.sessions.map((entry) => entry.sessionId)).toEqual([
      second.session.subAgentSessionId,
      ...rest,
    ]);
    expect(snapshot.sessions.map((entry) => entry.status).sort()).toEqual([
      "importing",
      "ready",
      "running",
    ]);
    const reloaded = managerHarness({
      load: async () => managerParts(harness.manager).store.state,
    });
    const after = await reloaded.manager.inspection().snapshot();
    expect(after.hasAgentRuns).toBe(true);
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
    expect((await card(harness, sessionId)).elapsedMs).toBe(650);
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
    harness.execution.finish(1);
    await settle();

    const prompt = await detailOf(session.subAgentSessionId);
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
      item: toolItem(harness, 0, "c1", { args: { q: "x" } }),
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
      args: { q: "x" },
    });
    expect(items[1].payloadState).toBe("truncated");
    expect(items.map((item) => item.payloadState).slice(2)).toEqual([
      ...Array(8).fill("captured"),
      "truncated",
    ]);
    expect(stateText(harness)).not.toMatch(/prefixsecret|runsecret11/);
    harness.probes.debug = false;
    const hidden = await harness.manager.inspection().getSession(session.subAgentSessionId);
    expect(hidden!.lifetime[0]).toMatchObject({ payloadState: "disabled" });
    expect(hidden!.lifetime[0].args).toBeUndefined();
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
    expect(await inspection.stopFromUser(idle.subAgentSessionId, null)).toBe("stopped");
    expect((await failureOf(inspection.stopFromUser("session-foreign", null))).error.code).toBe(
      "not-authorized",
    );
  });

  it("archives idle, running and importing sessions and keeps the fence when the archive save fails", async () => {
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
    ).toBe("stopped");
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
      "archived",
      "archived",
      "archived",
    ]);
    expect(
      state.imports.find((entry) => entry.runId === importing.receipt.runId)?.tombstoneReason,
    ).toBe("user-archive");
    await expect(
      delegator.continue(
        ready.session.subAgentSessionId,
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
    const answer = `${"y".repeat(4 * 1024 - 10)} token=replysecret`;
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
    expect(finished.replyExcerpt.length).toBeLessThanOrEqual(4 * 1024);
    const detail = await harness.manager.inspection().getSession(session.subAgentSessionId);
    const visible = JSON.stringify([
      harness.mainEvents,
      detail,
      managerParts(harness.manager).store.state,
    ]);
    expect(visible).not.toMatch(/promptsecret|replysecret|replys|hidden chain/);
  });
});
