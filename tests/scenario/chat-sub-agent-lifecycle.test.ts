import { describe, expect, it, vi } from "vitest";

import type { ChatRunRequest } from "@application/use-cases/chat";
import { TERMINAL_SAVE_WAIT_MS } from "@application/use-cases/chat/terminalSave";
import { MAX_CONCURRENT_CHAT_SESSIONS } from "@core/chat/chatSession";
import type { SavedChatSettings } from "@core/chat/savedChat";
import { settle } from "../support/async";
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
    await runPastDeadline(TERMINAL_SAVE_WAIT_MS, async () => {
      research.emit(0, completed);
      research.end(0);
      await settle();
    });
    expect(log).toEqual([`closeAll:${runId}:completed`]);
    expect(parent.status).toBe("completed");
    await settle();
    expect(queued.status).toBe("running");
    hold = null;
    release();
    await settle();
    expect(log).toEqual([`closeAll:${runId}:completed`, "commit:completed"]);
    for (let index = 1; index <= MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      research.emit(index, completed);
      research.end(index);
    }
    await settle();

    log.length = 0;
    await manager.start(parent.sessionId, request("Follow-up"));
    await settle();
    const followUpRunId = parent.activeRunId!;
    expect(children.hosts[0]!.bindings[1]!.binding.bindingGeneration).toBe(2);
    expect(children.hosts[0]!.bindings[1]!.delivery.deliveryEpoch).toBe(2);

    const idle = manager.createSession(thinking);
    await manager.start(idle.sessionId, request("Short"));
    await settle();
    research.emit(research.requests.length - 1, completed);
    research.end(research.requests.length - 1);
    await settle();
    log.length = 0;
    await manager.deleteChat(idle.chatId!);
    expect(log).toEqual([`dispose:${MAX_CONCURRENT_CHAT_SESSIONS + 1}`]);

    log.length = 0;
    let releaseClose = (): void => undefined;
    children.hosts[0]!.closeGate = new Promise<void>((resolve) => (releaseClose = resolve));
    const disposal = manager.dispose();
    await settle();
    expect(log).not.toContain("commit:interrupted");
    releaseClose();
    await disposal;
    expect(log.filter((entry) => !/^dispose:[1-9]/u.test(entry))).toEqual([
      `closeAll:${followUpRunId}:plugin-unload`,
      "commit:interrupted",
      "dispose:0",
    ]);
    expect(notices).toEqual(["interrupted"]);
  });
});
