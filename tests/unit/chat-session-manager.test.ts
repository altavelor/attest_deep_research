import { describe, expect, it, vi } from "vitest";

import type { ChatRunRequest, ChatSessionState } from "@application/use-cases/chat";
import type { ChatSessionManager } from "@application/use-cases/chat";
import type { ResearchService, ResearchStreamEvent } from "@application/use-cases/research";
import type { ResearchRequest } from "@application/contracts/research";
import type { ChatRepository } from "@application/ports";
import type { ResearchAnswer } from "@core/answer";
import type { SavedChat, SavedChatSettings } from "@core/chat/savedChat";
import { MAX_CONCURRENT_CHAT_SESSIONS } from "@core/chat/chatSession";
import { createTestSessionManager } from "../helpers/chatSessions";

const settings: SavedChatSettings = {
  chatModelProfileId: "model-id",
  indexProfileId: "index-id",
  searchMode: "indexOnly",
  contextMode: "include",
  researchMode: "instant",
};

function answerFor(text: string): ResearchAnswer {
  return {
    question: "Question?",
    answer: text,
    citations: [],
    followUpQuestions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function request(question: string): ChatRunRequest {
  return {
    question,
    chatHistory: [],
    appendQuestion: true,
    contextPaths: [],
    includeActiveFile: false,
    includeContextDiagnostics: false,
    modelLabel: "Model Label",
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface Gate {
  emit(event: ResearchStreamEvent): void;
  end(): void;
}

/** A research service whose stream is driven event by event from the test. */
function createGatedService(): {
  service: () => ResearchService;
  gates: Gate[];
  requests: ResearchRequest[];
  serviceCalls: number;
} {
  const gates: Gate[] = [];
  const requests: ResearchRequest[] = [];
  const state = { serviceCalls: 0 };

  const service = (): ResearchService => {
    state.serviceCalls += 1;
    return {
      answer: (nextRequest: ResearchRequest) => {
        requests.push(nextRequest);
        const queue: ResearchStreamEvent[] = [];
        let notify: (() => void) | null = null;
        let ended = false;
        gates.push({
          emit: (event) => {
            queue.push(event);
            notify?.();
          },
          end: () => {
            ended = true;
            notify?.();
          },
        });
        return (async function* stream() {
          while (true) {
            while (queue.length > 0) yield queue.shift()!;
            if (ended) return;
            await new Promise<void>((resolve) => {
              notify = () => {
                notify = null;
                resolve();
              };
            });
          }
        })();
      },
    } as unknown as ResearchService;
  };

  return {
    service,
    gates,
    requests,
    get serviceCalls() {
      return state.serviceCalls;
    },
  };
}

function newSession(manager: ChatSessionManager): ChatSessionState {
  return manager.createSession(settings);
}

describe("chat session manager concurrency", () => {
  it("runs two chats independently and routes each stream to its own session", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const first = newSession(manager);
    const second = newSession(manager);

    await manager.start(first.sessionId, request("First question"));
    await manager.start(second.sessionId, request("Second question"));
    await settle();

    gated.gates[0].emit({ type: "delta", content: "Alpha" });
    gated.gates[1].emit({ type: "delta", content: "Beta" });
    await settle();

    expect(first.messages.at(-1)?.content).toBe("Alpha");
    expect(second.messages.at(-1)?.content).toBe("Beta");
    expect(first.chatId).not.toBe(second.chatId);
    expect(first.status).toBe("running");
    expect(second.status).toBe("running");
  });

  it("stops only the requested session", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const first = newSession(manager);
    const second = newSession(manager);
    await manager.start(first.sessionId, request("First"));
    await manager.start(second.sessionId, request("Second"));
    await settle();

    manager.stop(first.sessionId);
    gated.gates[0].end();
    await settle();

    expect(first.status).toBe("interrupted");
    expect(second.status).toBe("running");
    expect(gated.requests[0].signal?.aborted).toBe(true);
    expect(gated.requests[1].signal?.aborted).toBe(false);
  });

  it("queues a run beyond the concurrency limit without creating model resources", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const sessions: ChatSessionState[] = [];
    for (let index = 0; index <= MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      const session = newSession(manager);
      sessions.push(session);
      await manager.start(session.sessionId, request(`Question ${index}`));
    }
    await settle();

    const queued = sessions[MAX_CONCURRENT_CHAT_SESSIONS];
    expect(sessions.filter((session) => session.status === "running")).toHaveLength(
      MAX_CONCURRENT_CHAT_SESSIONS,
    );
    expect(queued.status).toBe("queued");
    expect(gated.serviceCalls).toBe(MAX_CONCURRENT_CHAT_SESSIONS);
    expect(queued.chatId).not.toBeNull();
  });

  it("promotes only the oldest queued session when a slot is released", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const sessions: ChatSessionState[] = [];
    for (let index = 0; index < MAX_CONCURRENT_CHAT_SESSIONS + 2; index += 1) {
      const session = newSession(manager);
      sessions.push(session);
      await manager.start(session.sessionId, request(`Question ${index}`));
    }
    await settle();

    const [olderQueued, newerQueued] = sessions.slice(MAX_CONCURRENT_CHAT_SESSIONS);
    expect([olderQueued.status, newerQueued.status]).toEqual(["queued", "queued"]);

    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();

    expect(olderQueued.status).toBe("running");
    expect(newerQueued.status).toBe("queued");
    expect(gated.serviceCalls).toBe(MAX_CONCURRENT_CHAT_SESSIONS + 1);
  });

  it("removes a queued session on stop without contacting the model", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const sessions: ChatSessionState[] = [];
    for (let index = 0; index <= MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      const session = newSession(manager);
      sessions.push(session);
      await manager.start(session.sessionId, request(`Question ${index}`));
    }
    await settle();
    const queued = sessions[MAX_CONCURRENT_CHAT_SESSIONS];

    manager.stop(queued.sessionId);
    await settle();

    expect(queued.status).toBe("interrupted");
    expect(queued.interruptionReason).toBe("user");
    expect(gated.serviceCalls).toBe(MAX_CONCURRENT_CHAT_SESSIONS);
    const saved = await repository.loadChat(queued.chatId!);
    expect(saved?.lastRun).toMatchObject({ status: "interrupted", interruptionReason: "user" });

    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();
    expect(gated.serviceCalls).toBe(MAX_CONCURRENT_CHAT_SESSIONS);
  });
});

describe("chat session manager slot accounting", () => {
  it("does not promote another queued run when a queued run is stopped", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const sessions: ChatSessionState[] = [];
    for (let index = 0; index < MAX_CONCURRENT_CHAT_SESSIONS + 2; index += 1) {
      const session = newSession(manager);
      sessions.push(session);
      await manager.start(session.sessionId, request(`Question ${index}`));
    }
    await settle();
    const [firstQueued, secondQueued] = sessions.slice(MAX_CONCURRENT_CHAT_SESSIONS);

    manager.stop(firstQueued.sessionId);
    await settle();

    expect(firstQueued.status).toBe("interrupted");
    expect(secondQueued.status).toBe("queued");
    expect(gated.serviceCalls).toBe(MAX_CONCURRENT_CHAT_SESSIONS);
    expect(manager.listSessions().filter((session) => session.status === "running")).toHaveLength(
      MAX_CONCURRENT_CHAT_SESSIONS,
    );
  });
});

describe("chat session manager double submission", () => {
  it("starts one run only, even when two submissions race the first save", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const saveChat = vi.spyOn(repository, "saveChat");
    const session = newSession(manager);

    const results = await Promise.all([
      manager.start(session.sessionId, request("Question?")),
      manager.start(session.sessionId, request("Question?")),
    ]);
    await settle();

    expect(results.filter((result) => result.started)).toHaveLength(1);
    expect(saveChat).toHaveBeenCalledTimes(1);
    expect(gated.serviceCalls).toBe(1);
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });
});

describe("chat session manager promotion races", () => {
  async function fillSlotsAndQueueOne(manager: ChatSessionManager): Promise<ChatSessionState[]> {
    const sessions: ChatSessionState[] = [];
    for (let index = 0; index <= MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      const session = newSession(manager);
      sessions.push(session);
      await manager.start(session.sessionId, request(`Question ${index}`));
    }
    await settle();
    return sessions;
  }

  it("finishes a session stopped while its promotion write is still in flight", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const sessions = await fillSlotsAndQueueOne(manager);
    const promoted = sessions[MAX_CONCURRENT_CHAT_SESSIONS];
    let releaseWrite = (): void => {};
    vi.spyOn(repository, "setChatRunState").mockImplementation(
      () => new Promise((resolve) => (releaseWrite = () => resolve(null))),
    );

    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();
    expect(promoted.status).toBe("running");

    manager.stop(promoted.sessionId);
    releaseWrite();
    await settle();

    expect(promoted.status).toBe("interrupted");
    expect(manager.canDeleteChat(promoted.chatId!)).toBe(true);
    expect(gated.serviceCalls).toBe(MAX_CONCURRENT_CHAT_SESSIONS);
  });

  it("never exceeds the slot limit when a new run starts during a promotion write", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const sessions = await fillSlotsAndQueueOne(manager);
    const promoted = sessions[MAX_CONCURRENT_CHAT_SESSIONS];
    let releaseWrite = (): void => {};
    vi.spyOn(repository, "setChatRunState").mockImplementation(
      () => new Promise((resolve) => (releaseWrite = () => resolve(null))),
    );

    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();

    const latecomer = newSession(manager);
    await manager.start(latecomer.sessionId, request("Latecomer"));
    await settle();
    releaseWrite();
    await settle();

    expect(latecomer.status).toBe("queued");
    expect(promoted.status).toBe("running");
    expect(manager.listSessions().filter((session) => session.status === "running")).toHaveLength(
      MAX_CONCURRENT_CHAT_SESSIONS,
    );
    expect(gated.serviceCalls).toBe(MAX_CONCURRENT_CHAT_SESSIONS + 1);
  });

  it("queues a new run while other sessions are already waiting", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    await fillSlotsAndQueueOne(manager);
    manager.stop(manager.listSessions()[0].sessionId);
    gated.gates[0].end();
    const latecomer = newSession(manager);
    await manager.start(latecomer.sessionId, request("Latecomer"));
    await settle();

    expect(
      manager.listSessions().filter((session) => session.status === "running").length,
    ).toBeLessThanOrEqual(MAX_CONCURRENT_CHAT_SESSIONS);
  });
});

describe("chat session manager persistence", () => {
  it("persists exactly once at run start and once at completion", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const saveChat = vi.spyOn(repository, "saveChat");
    const session = newSession(manager);

    await manager.start(session.sessionId, request("Question?"));
    await settle();
    expect(saveChat).toHaveBeenCalledTimes(1);

    gated.gates[0].emit({ type: "delta", content: "One" });
    gated.gates[0].emit({ type: "delta", content: "Two" });
    gated.gates[0].emit({ type: "reasoning", segmentId: "r1", content: "Thinking" });
    await settle();
    expect(saveChat).toHaveBeenCalledTimes(1);

    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();
    expect(saveChat).toHaveBeenCalledTimes(2);
  });

  it("persists an unread completion when no view is attached", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const session = newSession(manager);
    await manager.start(session.sessionId, request("Question?"));
    await settle();

    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();

    expect(session.unreadCompletion).toBe(true);
    const saved = await repository.loadChat(session.chatId!);
    expect(saved?.unreadCompletion).toBe(true);
    expect(saved?.lastRun).toMatchObject({ status: "completed" });
  });

  it("leaves completion read when an attached view is showing that chat", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const session = newSession(manager);
    manager.select(session.sessionId);
    manager.attachView();
    await manager.start(session.sessionId, request("Question?"));
    await settle();

    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();

    expect(session.unreadCompletion).toBe(false);
  });

  it("clears the unread marker when the chat is viewed", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const session = newSession(manager);
    await manager.start(session.sessionId, request("Question?"));
    await settle();
    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();

    await manager.markViewed(session.sessionId);

    expect(session.unreadCompletion).toBe(false);
    expect((await repository.loadChat(session.chatId!))?.unreadCompletion).toBe(false);
  });
});

describe("chat session manager row status", () => {
  it("announces a completed run only until the chat is opened", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const session = newSession(manager);
    await manager.start(session.sessionId, request("Question?"));
    await settle();
    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();

    const summaryOf = async () => (await repository.listChats())[0];
    expect(manager.rowStatus(await summaryOf())).toBe("completed");

    await manager.markViewed(session.sessionId);

    expect(manager.rowStatus(await summaryOf())).toBe("idle");
  });

  it("applies the same rule to a chat that has no summary yet", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const session = newSession(manager);
    await manager.start(session.sessionId, request("Question?"));
    await settle();
    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();

    const withoutSummary = { id: session.chatId!, unreadCompletion: false };
    expect(manager.rowStatus(withoutSummary)).toBe("completed");

    await manager.markViewed(session.sessionId);

    expect(manager.rowStatus(withoutSummary)).toBe("idle");
  });

  it("keeps failed and interrupted markers regardless of unread state", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const session = newSession(manager);
    await manager.start(session.sessionId, request("Question?"));
    await settle();
    manager.stop(session.sessionId);
    gated.gates[0].end();
    await settle();

    const summary = (await repository.listChats())[0];
    expect(manager.rowStatus(summary)).toBe("interrupted");
    expect(manager.rowStatus({ ...summary, unreadCompletion: false })).toBe("interrupted");
  });

  it("reads a restored chat's row status from its persisted run", async () => {
    const { manager, repository } = createTestSessionManager();
    await repository.saveChat({
      id: "restored",
      messages: [{ role: "user", content: "Question?", createdAt: "2026-01-01T00:00:00.000Z" }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: settings,
      unreadCompletion: true,
      lastRun: {
        runId: "run-old",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:01:00.000Z",
        status: "completed",
      },
    });
    const summary = (await repository.listChats())[0];

    expect(manager.rowStatus(summary)).toBe("completed");
    expect(manager.rowStatus({ ...summary, unreadCompletion: false })).toBe("idle");
  });
});

describe("chat session manager deletion guard", () => {
  it("refuses to delete a chat while its run is not terminal", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const session = newSession(manager);
    await manager.start(session.sessionId, request("Question?"));
    await settle();
    const chatId = session.chatId!;

    expect(manager.canDeleteChat(chatId)).toBe(false);
    await expect(manager.deleteChat(chatId)).rejects.toThrow();
    expect(await repository.loadChat(chatId)).not.toBeNull();

    manager.stop(session.sessionId);
    gated.gates[0].end();
    await settle();

    expect(manager.canDeleteChat(chatId)).toBe(true);
    await manager.deleteChat(chatId);
    expect(await repository.loadChat(chatId)).toBeNull();
  });
});

describe("chat session manager deletion guard for queued and stopping chats", () => {
  it("keeps the guard while a chat is queued or stopping", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const sessions: ChatSessionState[] = [];
    for (let index = 0; index <= MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      const session = newSession(manager);
      sessions.push(session);
      await manager.start(session.sessionId, request(`Question ${index}`));
    }
    await settle();
    const queued = sessions[MAX_CONCURRENT_CHAT_SESSIONS];
    const running = sessions[0];

    expect(queued.status).toBe("queued");
    expect(manager.canDeleteChat(queued.chatId!)).toBe(false);
    await expect(manager.deleteChat(queued.chatId!)).rejects.toThrow();

    manager.stop(running.sessionId);
    expect(running.status).toBe("stopping");
    expect(manager.canDeleteChat(running.chatId!)).toBe(false);
    await expect(manager.deleteChat(running.chatId!)).rejects.toThrow();
    expect(await repository.loadChat(running.chatId!)).not.toBeNull();
  });
});

describe("chat session manager activity", () => {
  it("counts running sessions and unread completions separately", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const running = newSession(manager);
    const completed = newSession(manager);
    await manager.start(running.sessionId, request("Running"));
    await manager.start(completed.sessionId, request("Completed"));
    await settle();

    gated.gates[1].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[1].end();
    await settle();

    expect(manager.activity(await repository.listChats())).toEqual({
      runningCount: 1,
      unreadCompletedCount: 1,
    });
  });

  it("ignores queued and stopping sessions in the running count", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const sessions: ChatSessionState[] = [];
    for (let index = 0; index <= MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      const session = newSession(manager);
      sessions.push(session);
      await manager.start(session.sessionId, request(`Question ${index}`));
    }
    await settle();
    manager.stop(sessions[0].sessionId);

    expect(manager.activity(await repository.listChats()).runningCount).toBe(
      MAX_CONCURRENT_CHAT_SESSIONS - 1,
    );
  });
});

describe("chat session manager lifecycle", () => {
  it("interrupts every live run on dispose and persists it best effort", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const running = newSession(manager);
    await manager.start(running.sessionId, request("Question?"));
    await settle();
    gated.gates[0].emit({ type: "delta", content: "Partial" });
    await settle();

    const disposal = manager.dispose();

    expect(running.status).toBe("interrupted");
    expect(running.interruptionReason).toBe("plugin-unload");
    expect(gated.requests[0].signal?.aborted).toBe(true);
    await disposal;
    const saved = await repository.loadChat(running.chatId!);
    expect(saved?.lastRun).toMatchObject({
      status: "interrupted",
      interruptionReason: "plugin-unload",
    });
  });

  it("abandons a run whose first save finished after dispose", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const session = newSession(manager);

    const start = manager.start(session.sessionId, request("Question?"));
    await manager.dispose();
    const result = await start;
    await settle();

    expect(result.started).toBe(false);
    expect(session.status).toBe("idle");
    expect(gated.serviceCalls).toBe(0);
  });

  it("does not overwrite a terminal save that was in flight when dispose ran", async () => {
    const gated = createGatedService();
    const { manager, repository } = createTestSessionManager({
      createResearchService: gated.service,
    });
    const session = newSession(manager);
    await manager.start(session.sessionId, request("Question?"));
    await settle();

    const realSave = repository.saveChat.bind(repository);
    let releaseTerminalSave = (): void => {};
    const pending = new Promise<void>((resolve) => (releaseTerminalSave = () => resolve()));
    vi.spyOn(repository, "saveChat").mockImplementation(async (input) => {
      await pending;
      return realSave(input);
    });

    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();
    expect(session.status).toBe("completed");

    const disposal = manager.dispose();
    releaseTerminalSave();
    await disposal;
    await settle();

    expect(session.status).toBe("completed");
    expect((await repository.loadChat(session.chatId!))?.lastRun).toMatchObject({
      status: "completed",
    });
  });

  it("keeps the slot of a resubmitted chat when the previous terminal write lands", async () => {
    const gated = createGatedService();
    const repository = createUnorderedRepository();
    const { manager } = createTestSessionManager({
      createResearchService: gated.service,
      repository: repository.repository,
    });
    const session = newSession(manager);
    await manager.start(session.sessionId, request("Question?"));
    await settle();

    repository.holdNextSave();
    gated.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    gated.gates[0].end();
    await settle();
    expect(session.status).toBe("completed");

    await manager.start(session.sessionId, request("Follow-up?"));
    await settle();
    repository.releaseHeldSave();
    await settle();
    expect(session.status).toBe("running");

    for (let index = 0; index < MAX_CONCURRENT_CHAT_SESSIONS; index += 1) {
      const extra = newSession(manager);
      await manager.start(extra.sessionId, request(`Extra ${index}`));
    }
    await settle();

    expect(manager.listSessions().filter((entry) => entry.status === "running")).toHaveLength(
      MAX_CONCURRENT_CHAT_SESSIONS,
    );
  });

  it("keeps a session whose first save is still in flight when New Chat discards it", async () => {
    const gated = createGatedService();
    const repository = createUnorderedRepository();
    const { manager } = createTestSessionManager({
      createResearchService: gated.service,
      repository: repository.repository,
    });
    const session = newSession(manager);
    manager.select(session.sessionId);

    repository.holdNextSave();
    const start = manager.start(session.sessionId, request("Question?"));
    await settle();

    manager.discardSession(session.sessionId);
    repository.releaseHeldSave();
    await start;
    await settle();

    expect(manager.getSession(session.sessionId)).toBe(session);
    expect(session.status).toBe("running");
    expect(session.chatId).not.toBeNull();
    expect(gated.serviceCalls).toBe(1);
  });

  it("rejects new runs after dispose", async () => {
    const gated = createGatedService();
    const { manager } = createTestSessionManager({ createResearchService: gated.service });
    const session = newSession(manager);
    await manager.dispose();

    const result = await manager.start(session.sessionId, request("Question?"));

    expect(result.started).toBe(false);
    expect(gated.serviceCalls).toBe(0);
  });

  it("converts a stale persisted run to interrupted while preserving updatedAt", async () => {
    const { manager, repository } = createTestSessionManager();
    await seedStaleChat(repository);

    await manager.normalizeStaleChats();

    const recovered = await repository.loadChat("stale-chat");
    expect(recovered?.lastRun).toMatchObject({
      status: "interrupted",
      interruptionReason: "crash-recovery",
    });
    expect(recovered?.updatedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(recovered?.messages.at(-1)?.researchProgress?.phase).toBe("interrupted");
  });

  it("adopts a recovered chat as an interrupted session rather than a live run", async () => {
    const { manager, repository } = createTestSessionManager();
    await seedStaleChat(repository);
    await manager.normalizeStaleChats();
    const chat = await repository.loadChat("stale-chat");

    const session = manager.adoptChat(chat!, settings);

    expect(session.status).toBe("interrupted");
    expect(manager.getSessionByChatId("stale-chat")).toBe(session);
    expect(manager.adoptChat(chat!, settings)).toBe(session);
  });
});

/**
 * A repository that gives no ordering guarantee between concurrent writes, so
 * slot accounting cannot lean on the file adapter's per-chat mutation queue.
 */
function createUnorderedRepository(): {
  repository: ChatRepository;
  holdNextSave(): void;
  releaseHeldSave(): void;
} {
  const chats = new Map<string, SavedChat>();
  let sequence = 0;
  let hold: Promise<void> | null = null;
  let release = (): void => {};

  const repository: ChatRepository = {
    listChats: async () =>
      [...chats.values()].map((chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        messageCount: chat.messages.length,
        isFavorite: chat.isFavorite === true,
        unreadCompletion: chat.unreadCompletion,
        ...(chat.lastRun ? { lastRun: chat.lastRun } : {}),
      })),
    loadChat: async (id) => chats.get(id) ?? null,
    saveChat: async (input) => {
      const held = hold;
      hold = null;
      if (held) await held;
      sequence += 1;
      const id = input.id ?? `chat-${sequence}`;
      const now = input.updatedAt ?? `2026-01-01T00:00:0${sequence % 10}.000Z`;
      const chat: SavedChat = {
        schemaVersion: 4,
        id,
        title: input.title ?? "Chat",
        createdAt: input.createdAt ?? chats.get(id)?.createdAt ?? now,
        updatedAt: now,
        messages: input.messages,
        lastAnswer: input.lastAnswer,
        attachedContextPaths: [...input.attachedContextPaths],
        chatSettings: input.chatSettings,
        sourceRegistry: input.sourceRegistry ?? { sources: [] },
        unreadCompletion: input.unreadCompletion ?? chats.get(id)?.unreadCompletion ?? false,
        ...((input.lastRun ?? chats.get(id)?.lastRun)
          ? { lastRun: input.lastRun ?? chats.get(id)!.lastRun! }
          : {}),
      };
      chats.set(id, chat);
      return chat;
    },
    renameChat: async (id) => chats.get(id) ?? null,
    setChatFavorite: async (id) => chats.get(id) ?? null,
    setChatUnreadCompletion: async (id, unreadCompletion) => {
      const chat = chats.get(id);
      if (!chat) return null;
      const next = { ...chat, unreadCompletion };
      chats.set(id, next);
      return next;
    },
    setChatRunState: async (id, lastRun) => {
      const chat = chats.get(id);
      if (!chat) return null;
      const next = { ...chat, lastRun };
      chats.set(id, next);
      return next;
    },
    deleteChat: async (id) => {
      chats.delete(id);
    },
  };

  return {
    repository,
    holdNextSave: () => {
      hold = new Promise<void>((resolve) => (release = () => resolve()));
    },
    releaseHeldSave: () => release(),
  };
}

async function seedStaleChat(repository: ChatRepository): Promise<void> {
  await repository.saveChat({
    id: "stale-chat",
    title: "Interrupted by a crash",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    messages: [
      { role: "user", content: "Question?", createdAt: "2026-06-01T10:00:00.000Z" },
      {
        role: "assistant",
        content: "Partial",
        createdAt: "2026-06-01T10:00:00.000Z",
        researchProgress: {
          phase: "streaming",
          disclosure: "auto",
          view: "expanded",
          reasoning: { phase: "complete", segments: [] },
          checkpoints: [],
          chain: [],
        },
      },
    ],
    lastAnswer: null,
    attachedContextPaths: [],
    chatSettings: settings,
    unreadCompletion: false,
    lastRun: { runId: "run-stale", startedAt: "2026-06-01T10:00:00.000Z", status: "running" },
  });
}
