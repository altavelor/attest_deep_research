import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import { researchSectionView, type SavedChatSettings } from "@core/chat/savedChat";
import { finishedResearchReport } from "@application/use-cases/research/deep-research";
import type { ChatModelProvider } from "@core/agent";
import { startResearchState } from "@core/research/deepResearch";
import { eventually } from "../support/async";
import { ChatWriteBuffer } from "@application/use-cases/chat";
import { ChatResearchState } from "@application/use-cases/chat/ChatResearchState";
import { chatSaveInput } from "@application/use-cases/chat/chatSaveInput";
import { sessionStateFromSavedChat } from "@application/use-cases/chat/chatSessionSnapshots";
import { ManualClock, chatInput } from "../support/chatDocuments";
import { createTestSessionManager } from "../support/chatSessions";
import {
  BranchModelRounds,
  PlanAndReportModel,
  StallingPlanModel,
  deepResearchService,
  researchTurn,
} from "../support/deepResearch";
import { MemoryFileSystem } from "../support/memoryFileSystem";
import { FakeChatModel, FakeRetriever } from "../support/researchFakes";
import { markdownSource, retrieved } from "../support/factories";

const SETTINGS: SavedChatSettings = {
  chatModelProfileId: "profile",
  searchMode: "indexOnly",
  researchMode: "deep-research",
};

function reopen(fileSystem: MemoryFileSystem, model: ChatModelProvider, errors: unknown[] = []) {
  const repository = new FileChatRepository({ fileSystem, folder: "chats" });
  const { manager } = createTestSessionManager({
    repository,
    createResearchService: () =>
      deepResearchService(model, true, {
        retriever: new FakeRetriever({
          chunks: [
            retrieved("chunk-1", markdownSource("Notes/tides.md"), "The moon causes tides."),
          ],
          citations: [],
          usedFallback: false,
        }),
        modelRound: new BranchModelRounds(),
      }),
    logError: (error) => errors.push(error),
  });
  return { repository, manager };
}

describe("deep research turns through the chat runtime", () => {
  it("starts a research, keeps its pending plan across a reload and runs it on approval", async () => {
    const fileSystem = new MemoryFileSystem();
    const model = new PlanAndReportModel();
    const first = reopen(fileSystem, model);
    const session = first.manager.createSession(SETTINGS);
    await first.manager.start(session.sessionId, researchTurn("How do tides work?"));
    await eventually(() => expect(session.status).toBe("completed"));

    const second = reopen(fileSystem, model);
    const saved = await second.repository.loadChat(session.chatId!);
    const section = saved?.deepResearch?.status === "ready" ? saved.deepResearch.section : null;
    const active = section!.active!;
    expect(active.pending?.kind).toBe("plan");
    expect((await second.repository.listChats())[0]?.requiresUserAction).toBe(true);

    const adopted = second.manager.adoptChat(saved!, SETTINGS);
    const approve = researchTurn("Approve", {
      type: "decision",
      decision: {
        researchId: active.researchId,
        decisionId: active.pending!.decisionId,
        expectedRevision: active.revision,
        payload: { action: "approve" },
      },
    });
    await second.manager.start(adopted.sessionId, approve);
    await eventually(() => expect(adopted.status).toBe("completed"));
    await second.manager.start(adopted.sessionId, approve);
    await eventually(() => expect(adopted.status).toBe("failed"));
    expect(adopted.messages.at(-1)?.content).toContain("no longer matches the research");

    const approved = await reopen(fileSystem, model).repository.loadChat(session.chatId!);
    const finalSection =
      approved?.deepResearch?.status === "ready" ? approved.deepResearch.section : null;
    expect(finalSection).toMatchObject({
      active: null,
      history: [{ researchId: active.researchId, phase: "completed" }],
    });
    const reportMessage = approved!.messages.at(-3)!;
    expect(reportMessage.research?.researchId).toBe(active.researchId);
    const view = researchSectionView(approved!.deepResearch);
    expect(finishedResearchReport(view, approved!.messages, active.researchId)).toMatchObject({
      quality: "complete",
      markdown: reportMessage.content,
    });
    expect(finishedResearchReport(view, approved!.messages, "research-other")).toBeNull();
  });

  it("ends a research stopped or abandoned while drafting and lets a plain message start anew", async () => {
    const model = new StallingPlanModel();
    const { manager } = reopen(new MemoryFileSystem(), model);
    const session = manager.createSession(SETTINGS);
    await manager.start(session.sessionId, researchTurn("First"));
    await eventually(() => expect(model.requests).toHaveLength(1));
    manager.stop(session.sessionId);
    await eventually(() => expect(session.status).toBe("interrupted"));
    const stopped = session.deepResearch?.status === "ready" ? session.deepResearch.section : null;
    expect(stopped).toMatchObject({ active: null, history: [{ phase: "cancelled" }] });

    const leftover = startResearchState("research-left", "Crashed", "2026-01-01T00:00:00.000Z");
    session.deepResearch = { status: "ready", section: { ...stopped!, active: leftover } };
    await manager.start(session.sessionId, researchTurn("Second"));
    await eventually(() => expect(session.status).toBe("completed"));
    const restarted =
      session.deepResearch?.status === "ready" ? session.deepResearch.section : null;
    expect(restarted?.active).toMatchObject({ question: "Second", phase: "awaiting-approval" });
    expect(restarted?.history[0]).toMatchObject({
      researchId: "research-left",
      phase: "failed",
      terminalReason: "Interrupted during planning.",
    });
  });

  it("keeps a chat with an unreadable section readable and refuses its research turns", async () => {
    const fileSystem = new MemoryFileSystem();
    const model = new FakeChatModel();
    const first = reopen(fileSystem, model);
    const created = await first.repository.saveChat({
      id: "chat-1",
      messages: [{ role: "user", content: "Earlier", createdAt: "2026-01-01T00:00:00.000Z" }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: SETTINGS,
    });
    const path = "chats/chat-1.json";
    const raw = JSON.parse(await fileSystem.readText(path)) as Record<string, unknown>;
    await fileSystem.writeText(path, JSON.stringify({ ...raw, deepResearch: { schema: 99 } }));

    const errors: unknown[] = [];
    const second = reopen(fileSystem, model, errors);
    const saved = await second.repository.loadChat(created.id);
    expect(saved?.messages).toHaveLength(1);
    expect(saved?.deepResearch?.status).toBe("unreadable");

    const adopted = second.manager.adoptChat(saved!, SETTINGS);
    await second.manager.start(adopted.sessionId, researchTurn("Another question"));
    await eventually(() => expect(adopted.status).toBe("failed"));
    expect(adopted.messages.at(-1)?.content).toContain("research state of this chat is unreadable");
    expect(model.requests).toHaveLength(0);
    expect(errors[0]).toMatchObject({
      code: "DEEP_RESEARCH_REJECTED",
      details: { reason: "research-state-unreadable" },
    });
    expect(JSON.parse(await fileSystem.readText(path)).deepResearch).toEqual({ schema: 99 });
  });

  it("does not let a retried batch write a section whose commit was rolled back", async () => {
    const fileSystem = new MemoryFileSystem();
    const repository = new FileChatRepository({ fileSystem, folder: "chats" });
    const saved = await repository.saveChat(chatInput({ chatSettings: SETTINGS }));
    let failNext = true;
    const flaky = Object.create(repository) as FileChatRepository;
    flaky.commitChatDocument = (change) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("Disk busy"));
      }
      return repository.commitChatDocument(change);
    };
    const clock = new ManualClock();
    const state = sessionStateFromSavedChat("session-1", saved, SETTINGS);
    const buffer = new ChatWriteBuffer({
      repository: flaky,
      getChatId: () => state.chatId,
      onChatBound: () => undefined,
      base: null,
      baseline: null,
      now: clock.now,
      scheduleTimeout: clock.scheduleTimeout,
    });
    const research = new ChatResearchState({
      state,
      persist: () =>
        buffer.flushThrough(buffer.markChatDirty(chatSaveInput(state, false)), "barrier"),
      persistLater: () => void buffer.markChatDirty(chatSaveInput(state, false)),
    });
    const planning = startResearchState("research-1", "Q", "2026-01-01T00:00:00.000Z");

    await expect(research.commit(planning, null)).rejects.toThrow("Disk busy");
    await clock.advance(60_000);

    expect(failNext).toBe(false);
    expect(JSON.parse(await fileSystem.readText("chats/chat-1.json")).deepResearch).toBeUndefined();
    expect(research.read()).toEqual({ status: "ready", active: null, history: [] });
  });
});
