import { describe, expect, it } from "vitest";

import { ChatStorageError } from "@application/ports";
import { ChatWriteBuffer, type ChatWriteBufferLimits } from "@application/use-cases/chat";
import type { SubAgentBufferedValue } from "@core/research";
import {
  chatInput,
  ManualClock,
  ScriptedChatRepository,
  sessionDelta,
  subAgentSection,
} from "../support/chatDocuments";
import { applyAll, readySubAgentRecord, runToImport } from "../support/subAgentSessions";

const BASE = { content: "c", subAgents: "s" };

function completedSection() {
  return subAgentSection([applyAll(readySubAgentRecord(), runToImport("run-1"))]);
}

function setup(
  limits: Partial<ChatWriteBufferLimits> = {},
  chatId: string | null = "chat-1",
  base = subAgentSection(),
) {
  const repository = new ScriptedChatRepository();
  const clock = new ManualClock();
  const errors: Error[] = [];
  const writer = new ChatWriteBuffer({
    repository,
    getChatId: () => chatId,
    onChatBound: () => undefined,
    base,
    baseline: BASE,
    now: clock.now,
    scheduleTimeout: clock.scheduleTimeout,
    limits,
    onStorageError: (error) => errors.push(error),
  });
  return { repository, clock, writer, errors };
}

function observation(id: string, payload: string): SubAgentBufferedValue {
  return {
    op: "set",
    entity: "observation",
    id,
    fields: { kind: "tool-end", sessionId: "session-1", runId: "run-1", cited: false, payload },
  };
}

function sessionTitles(repository: ScriptedChatRepository): string[] {
  return repository.commits.map((change) => change.subAgents?.records[0]?.session.title ?? "-");
}

describe("ChatWriteBuffer triggers", () => {
  it("flushes 500 ms after the first change and later changes do not move the deadline", async () => {
    const { repository, clock, writer } = setup();
    writer.markDirty("a", 1, sessionDelta("session-1"));
    await clock.advance(300);
    writer.markDirty("b", 2, sessionDelta("session-1", { title: "Later" }));
    await clock.advance(199);
    expect(repository.commits).toHaveLength(0);

    await clock.advance(1);

    expect(sessionTitles(repository)).toEqual(["Later"]);
  });

  it("holds a second timed flush for 2000 ms after the previous save but not a barrier", async () => {
    const { repository, clock, writer } = setup();
    writer.markDirty("a", 1, sessionDelta("session-1"));
    await clock.advance(500);
    writer.markDirty("a", 2, sessionDelta("session-1", { title: "Second" }));
    await clock.advance(1999);
    expect(repository.commits).toHaveLength(1);
    await clock.advance(1);
    expect(repository.commits).toHaveLength(2);

    writer.markDirty("a", 3, sessionDelta("session-1", { title: "Third" }));
    await writer.flushThrough(3, "barrier");

    expect(sessionTitles(repository)).toEqual(["Renamed", "Second", "Third"]);
  });

  it.each([
    ["below", 1, 0],
    ["at", 2, 1],
  ])(
    "flushes at once only when pending bytes reach the size limit (%s)",
    async (_side, extra, commits) => {
      const delta = sessionDelta("session-1");
      const bytes = new TextEncoder().encode(JSON.stringify(delta)).length;
      const { repository, clock, writer } = setup({ maxBatchBytes: bytes * 2 });
      writer.markDirty("a", 1, delta);
      if (extra === 2) writer.markDirty("b", 2, delta);

      await clock.advance(0);

      expect(repository.commits).toHaveLength(commits);
    },
  );

  it.each([
    [2, 0],
    [3, 1],
  ])("counts %i accepted updates of one key toward a limit of three", async (updates, commits) => {
    const { repository, clock, writer } = setup({ maxUpdates: 3 });
    for (let revision = 1; revision <= updates; revision += 1) {
      writer.markDirty("a", revision, sessionDelta("session-1"));
    }

    await clock.advance(0);

    expect(repository.commits).toHaveLength(commits);
  });
});

describe("ChatWriteBuffer durability", () => {
  it("keeps a newer revision through an in-flight failure and its retry", async () => {
    const { repository, clock, writer } = setup();
    const release = repository.holdNext();
    writer.markDirty("a", 1, sessionDelta("session-1"));
    const first = writer.flushThrough(1, "barrier");
    writer.markDirty("a", 2, sessionDelta("session-1", { title: "Newer" }));
    repository.failNext(new Error("disk full"));
    release();
    await expect(first).rejects.toThrow("disk full");

    const second = writer.flushThrough(2, "timer");
    await clock.advance(2000);
    await second;

    expect(sessionTitles(repository)).toEqual(["Renamed", "Newer"]);
  });

  it("flushes a barrier at once without acknowledging a failed save and disposes its timer", async () => {
    const { repository, clock, writer } = setup();
    repository.failNext(new Error("offline"));
    const revision = writer.markChatDirty(chatInput());

    await expect(writer.flushThrough(revision, "barrier")).rejects.toThrow("offline");
    expect(clock.pendingTimers()).toBe(1);

    await writer.dispose();
    expect(clock.pendingTimers()).toBe(0);
    expect(repository.commits).toHaveLength(2);
  });

  it("merges a pending timed batch and its waiters into a recovery marker commit", async () => {
    const { repository, writer } = setup();
    writer.markDirty("a", 1, sessionDelta("session-1"));
    const drain = writer.flushThrough(1, "timer");
    const marker: SubAgentBufferedValue = {
      op: "set",
      entity: "marker",
      id: "parent-1",
      fields: {
        terminalReason: "stopped",
        createdAt: "2026-10-26T10:00:00.000Z",
        fencedRunIds: [],
        cancelledImports: [],
        unresolvedActionKeys: [],
      },
    };
    writer.markDirty("marker", 2, marker);

    await Promise.all([drain, writer.flushThrough(2, "barrier")]);

    expect(repository.commits).toHaveLength(1);
    expect(repository.commits[0]?.subAgents?.recoveryMarkers).toHaveLength(1);
  });

  it("lets a tombstone and newer revisions win over a late snapshot", async () => {
    const { repository, writer } = setup();
    writer.markDirty("session", 5, { op: "delete", entity: "session", id: "session-1" });
    writer.markDirty("session", 4, sessionDelta("session-1", { title: "Late" }));

    await writer.flushThrough(5, "barrier");

    expect(repository.commits[0]?.subAgents?.records).toEqual([]);
  });

  it("fences writes for deletion and resumes after reopen", async () => {
    const { repository, writer } = setup();
    const release = repository.holdNext();
    const inFlight = writer.flushThrough(writer.markChatDirty(chatInput()), "barrier");
    const waiting = writer.flushThrough(
      writer.markChatDirty(chatInput({ title: "Next" })),
      "timer",
    );

    const discarded = writer.discard();
    release();
    await discarded;

    await inFlight;
    await expect(waiting).rejects.toMatchObject({
      code: "chat-missing",
      message: "The chat was deleted; nothing more is saved for it.",
    });
    expect(() => writer.markChatDirty(chatInput())).toThrow(ChatStorageError);
    writer.reopen();
    await writer.flushThrough(writer.markChatDirty(chatInput({ title: "After" })), "barrier");
    expect(repository.commits.map((change) => change.chat?.title)).toEqual([undefined, "After"]);
  });

  it("refuses sub-agent deltas before the chat has a durable id", () => {
    const { writer } = setup({}, null);

    expect(() => writer.markDirty("a", 1, sessionDelta("session-1"))).toThrow(
      "Sub-agent state cannot be buffered before the chat has a durable id.",
    );
  });
});

describe("ChatWriteBuffer limits", () => {
  it("evicts details first and then refuses new work while chat saves continue", async () => {
    const { repository, writer } = setup({ fileGuardChars: 500 }, "chat-1", completedSection());
    writer.markChatDirty(chatInput());
    writer.markDirty("o1", 2, observation("o1", "x".repeat(400)));
    await writer.flushThrough(2, "barrier");
    const create: SubAgentBufferedValue = {
      op: "set",
      entity: "create",
      id: "create-2",
      fields: { status: "pending" },
    };

    expect(repository.commits[0]?.subAgents?.observation[0]).toMatchObject({
      payload: null,
      evicted: { reason: "chat size limit" },
    });
    expect(() => writer.markDirty("create-2", 3, create)).toThrow(
      new ChatStorageError(
        "file-too-large",
        "This chat file is too large for new sub-agent work; start a new chat.",
      ),
    );
    await writer.flushThrough(writer.markChatDirty(chatInput({ title: "Still saved" })), "barrier");
    expect(repository.commits.at(-1)?.chat?.title).toBe("Still saved");
  });

  it("applies backpressure only to pending deltas and coalesces parallel barriers", async () => {
    const delta = sessionDelta("session-1");
    const bytes = new TextEncoder().encode(JSON.stringify(delta)).length;
    const { repository, writer } = setup({ maxPendingBytes: bytes * 2, maxBatchBytes: 1e9 });
    writer.markChatDirty(
      chatInput({ messages: [{ role: "user", content: "x".repeat(300_000), createdAt: "t" }] }),
    );
    expect(writer.markDirty("a", 2, delta)).toBe("accepted");
    expect(writer.markDirty("b", 3, delta)).toBe("accepted");
    expect(writer.markDirty("c", 4, delta)).toBe("full");

    await Promise.all([writer.flushThrough(2, "barrier"), writer.flushThrough(3, "barrier")]);

    expect(repository.commits).toHaveLength(1);
    expect(writer.markDirty("c", 4, delta)).toBe("accepted");
  });
});
