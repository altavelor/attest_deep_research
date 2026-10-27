import { describe, expect, it, vi } from "vitest";

import type { ChatRunRequest } from "@application/use-cases/chat";
import type { ChatSessionRuntime } from "@application/use-cases/chat/ChatSessionRuntime";
import { TERMINAL_SAVE_WAIT_MS } from "@application/use-cases/chat/terminalSave";
import { MAX_CONCURRENT_CHAT_SESSIONS } from "@core/chat/chatSession";
import type { SavedChatSettings } from "@core/chat/savedChat";
import { ChatStorageError } from "@application/ports/chat";
import { settle } from "../support/async";
import { sessionDelta } from "../support/chatDocuments";
import { createTestSessionManager, fakeChildHosts, gatedResearch } from "../support/chatSessions";
import { runPastDeadline } from "../support/timers";

vi.mock("@shared", async (importOriginal) => {
  const { withGlobalTimers } = await import("../support/timers");
  return withGlobalTimers(await importOriginal<typeof import("@shared")>());
});

const thinking: SavedChatSettings = {
  chatModelProfileId: "model",
  searchMode: "webOnly",
  researchMode: "thinking",
};

function request(question: string): ChatRunRequest {
  return {
    question,
    chatHistory: [],
    appendQuestion: true,
    contextPaths: [],
    includeActiveFile: false,
    includeContextDiagnostics: false,
    modelLabel: "Model",
  };
}

const completed = {
  type: "complete" as const,
  answer: { question: "Q", answer: "A", citations: [], followUpQuestions: [], createdAt: "t" },
};

describe("chat runtime and its child host", () => {
  it("keeps the normative order of start, terminal, unload and delete around the child host", async () => {
    const children = fakeChildHosts();
    const { log } = children;
    const research = gatedResearch();
    const { manager, repository } = createTestSessionManager({
      createResearchService: research.service,
      createSubAgentSessionManager: children.factory,
    });
    const commit = repository.commitChatDocument.bind(repository);
    let failNext = true;
    let notices: string[] = [];
    let hold: Promise<void> | null = null;
    vi.spyOn(repository, "commitChatDocument").mockImplementation(async (change) => {
      if (failNext) {
        failNext = false;
        throw new Error("Disk full");
      }
      if (hold) await hold;
      log.push(`commit:${change.chat?.lastRun?.status ?? "-"}`);
      notices = change.chat?.subAgentNotices?.map((notice) => notice.kind) ?? [];
      return commit(change);
    });

    const parent = manager.createSession(thinking);
    expect(await manager.start(parent.sessionId, request("First"))).toMatchObject({
      started: false,
    });
    expect(parent.chatId).toBeNull();
    expect(log).toEqual([]);

    await manager.start(parent.sessionId, request("First"));
    await settle();
    const runId = parent.activeRunId!;
    expect(children.hosts).toHaveLength(1);
    expect(children.hosts[0]!.bindings[0]!.binding).toEqual({
      chatSessionId: parent.chatId,
      parentRunId: runId,
      bindingGeneration: 1,
    });
    const workers = research.requests[0]!.subAgentMapSources!.workers;
    const work = { requestId: "w", task: "t", sourcePath: "a.md", maxResultChars: 20_000 };
    await workers.runSource({ ...work, maxRounds: 3 }).catch(() => undefined);
    const mapGrant = children.hosts[0]!.bindings.at(-1)!.delivery.grantId;
    expect(children.hosts[0]!.context.resolveGrant(mapGrant)).toMatchObject({
      callerMode: "thinking",
      origin: "map_sources",
      maximumSourcePolicy: { searchMode: "none", allowActiveFile: false, allowNoteMutation: false },
      limits: { maxRounds: 3, maxResultChars: 20_000, maxSearches: 20 },
    });

    const others = [];
    for (let index = 1; index <= MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      const other = manager.createSession({ ...thinking, researchMode: "instant" });
      await manager.start(other.sessionId, request(`Other ${index}`));
      others.push(other);
    }
    await settle();
    const queued = others.at(-1)!;
    expect(queued.status).toBe("queued");

    log.length = 0;
    let release = (): void => undefined;
    hold = new Promise<void>((resolve) => (release = resolve));
    children.hosts[0]!.closeGate = new Promise<void>(() => undefined);
    await runPastDeadline(TERMINAL_SAVE_WAIT_MS, async () => {
      research.emit(0, completed);
      research.end(0);
      await settle();
    });
    expect(log).toEqual([`interrupt:${runId}`, `closeAll:${runId}:completed`]);
    expect(children.hosts[0]!.context.resolveGrant(mapGrant)).toBeNull();
    await workers.runSource({ ...work, maxRounds: 4 }).catch(() => undefined);
    const closingGrant = children.hosts[0]!.bindings.at(-1)!.delivery.grantId;
    expect([closingGrant, children.hosts[0]!.context.resolveGrant(closingGrant)]).toEqual([
      `grant-${runId}-map-4-20000`,
      null,
    ]);
    expect(parent.status).toBe("completed");
    await settle();
    expect(queued.status).toBe("running");
    children.hosts[0]!.closeGate = Promise.resolve();
    hold = null;
    release();
    await settle();
    expect(log).toEqual([
      `interrupt:${runId}`,
      `closeAll:${runId}:completed`,
      `delegator:${runId}`,
      "commit:completed",
    ]);
    for (let index = 1; index <= MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      research.emit(index, completed);
      research.end(index);
    }
    await settle();

    log.length = 0;
    await manager.start(parent.sessionId, request("Follow-up"));
    await settle();
    const followUpRunId = parent.activeRunId!;
    expect(children.hosts[0]!.bindings.at(-1)!.binding.bindingGeneration).toBe(2);
    expect(children.hosts[0]!.bindings.at(-1)!.delivery.deliveryEpoch).toBe(2);

    const idle = manager.createSession(thinking);
    await manager.start(idle.sessionId, request("Short"));
    await settle();
    research.emit(research.requests.length - 1, completed);
    research.end(research.requests.length - 1);
    await settle();
    log.length = 0;
    const idleWriter = children.hosts.at(-1)!.context.writer;
    const removeChat = repository.deleteChat.bind(repository);
    let lateWrite: unknown = null;
    vi.spyOn(repository, "deleteChat").mockImplementationOnce(async (id) => {
      try {
        idleWriter.markDirty("s", 9, sessionDelta("s"));
      } catch (error) {
        lateWrite = error;
      }
      await removeChat(id);
    });
    await manager.deleteChat(idle.chatId!);
    expect(lateWrite).toBeInstanceOf(ChatStorageError);
    expect(log).toEqual([`dispose:${MAX_CONCURRENT_CHAT_SESSIONS + 1}`]);

    log.length = 0;
    let releaseClose = (): void => undefined;
    children.hosts[0]!.closeGate = new Promise<void>((resolve) => (releaseClose = resolve));
    const runtimes = (manager as unknown as { sessions: Map<string, ChatSessionRuntime> }).sessions;
    const runtime = runtimes.get(parent.sessionId)!;
    const disposal = manager.dispose();
    await settle();
    await Promise.race([runtime.closeSubAgents(followUpRunId, "again"), settle()]);
    expect(log).not.toContain("commit:interrupted");
    releaseClose();
    await disposal;
    expect(log.filter((entry) => !/^dispose:[1-9]/u.test(entry))).toEqual([
      `interrupt:${followUpRunId}`,
      `closeAll:${followUpRunId}:plugin-unload`,
      "commit:interrupted",
      "dispose:0",
    ]);
    expect(notices).toEqual(["interrupted"]);
  });

  it("logs a failed child close and unloads once the shared budget passes while children never close", async () => {
    const children = fakeChildHosts();
    const research = gatedResearch();
    const logged: unknown[] = [];
    const { manager } = createTestSessionManager({
      createResearchService: research.service,
      createSubAgentSessionManager: children.factory,
      logError: (error) => logged.push(error),
    });
    const parent = manager.createSession(thinking);
    await manager.start(parent.sessionId, request("First"));
    await settle();
    const changes: string[] = [];
    manager.subscribe((change) => void changes.push(change.kind));
    const notice = (parentRunId: string) => ({
      type: "notice" as const,
      entry: {
        eventKey: `notice:${parentRunId}:queued`,
        parentRunId,
        description: "Child",
        createdAt: "t",
        sessionId: "child-1",
        runId: "child-run-1",
        kind: "queued" as const,
      },
    });
    children.hosts[0]!.context.mainEvents?.publish([notice("foreign-run")]);
    expect([parent.subAgentNotices.length, changes]).toEqual([0, []]);
    children.hosts[0]!.context.mainEvents?.publish([notice(parent.activeRunId!)]);
    expect(parent.subAgentNotices.map((entry) => entry.parentRunId)).toEqual([parent.activeRunId]);
    const failure = new Error("Close failed.");
    children.hosts[0]!.closeGate = Promise.reject(failure);
    research.emit(0, completed);
    research.end(0);
    await settle();
    expect(logged).toEqual([failure]);
    await manager.start(parent.sessionId, request("Second"));
    await settle();
    children.hosts[0]!.closeGate = new Promise<void>(() => undefined);
    children.log.length = 0;

    await runPastDeadline(TERMINAL_SAVE_WAIT_MS, () => manager.dispose());

    expect(children.log.filter((entry) => !entry.startsWith("closeAll"))).toEqual([
      "interrupt:run-2",
      "dispose:0",
    ]);
  });
});
