import { describe, expect, it } from "vitest";

import type { SavedChatSettings } from "@core/chat/savedChat";
import { settle } from "../support/async";
import { endTurn, realSubAgentChat, startTurn } from "../support/chatSubAgentWiring";
import { MemoryFileSystem } from "../support/memoryFileSystem";
import { FakeSubAgentExecution, executionResult } from "../support/subAgentSessions";

const thinking: SavedChatSettings = {
  chatModelProfileId: "model",
  searchMode: "webOnly",
  researchMode: "thinking",
};

describe("chat-scoped sub-agent sessions through the real chat wiring", () => {
  it("continues a turn-1 agent from turn 2, turn 3 and after a reload with its options", async () => {
    const fileSystem = new MemoryFileSystem();
    const first = realSubAgentChat(fileSystem);
    const chat = first.manager.createSession(thinking);
    const execution = new FakeSubAgentExecution();

    const t1 = await startTurn(first, chat.sessionId, "First", execution);
    const delegator1 = t1.request.subAgentDelegator!;
    const session = await delegator1.create({
      createRequestId: "c-1",
      title: "Investigate a",
      resources: ["example.org"],
      maxSearches: 3,
    });
    const r1 = await delegator1.run(
      session.subAgentSessionId,
      { type: "initial", task: "Investigate a" },
      "s-1",
    );
    await settle();
    execution.finish(0, executionResult("First answer"));
    await settle();
    await endTurn(first, t1.index);

    const t2 = await startTurn(first, chat.sessionId, "Ask the same agent", execution);
    expect(await t2.request.subAgentParent!.listSessions!()).toEqual([
      expect.objectContaining({ sessionId: session.subAgentSessionId, state: "finished" }),
    ]);
    const delegator2 = t2.request.subAgentDelegator!;
    const r2 = await delegator2.continue(
      session.subAgentSessionId,
      { type: "follow-up", task: "Clarify" },
      "s-2",
    );
    await settle();
    expect((chat.subAgentDispatches ?? []).map((entry) => entry.parentRunId)).toEqual([
      t1.runId,
      t2.runId,
    ]);
    execution.fail(1);
    await settle();
    expect((await delegator2.getResult(session.subAgentSessionId, r1.runId)).state).toBe(
      "completed",
    );
    await endTurn(first, t2.index);

    const t3 = await startTurn(first, chat.sessionId, "Retry it", execution);
    const r3 = await t3.request.subAgentDelegator!.retry(
      session.subAgentSessionId,
      { runId: r2.runId },
      "s-3",
    );
    await settle();
    await first.manager.stop(chat.sessionId);
    first.research.end(t3.index);
    await settle();
    const saved = await first.repository.loadChat(chat.chatId!);
    await first.manager.dispose();

    const second = realSubAgentChat(fileSystem);
    const reopened = second.manager.adoptChat(saved!, thinking);
    const t4 = await startTurn(second, reopened.sessionId, "Continue after reload", execution);
    expect((await t4.request.subAgentParent!.listSessions!())[0]?.state).toBe("interrupted");
    await t4.request.subAgentDelegator!.retry(
      session.subAgentSessionId,
      { runId: r3.runId },
      "s-4",
    );
    await settle();

    expect(execution.requests.at(-1)).toMatchObject({
      resources: ["example.org"],
      limits: { maxSearches: 3 },
    });
  });
});
