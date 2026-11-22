import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import type { SavedChatSettings } from "@core/chat/savedChat";
import { eventually } from "../support/async";
import { createTestSessionManager } from "../support/chatSessions";
import { deepResearchService, planReply, researchTurn } from "../support/deepResearch";
import { MemoryFileSystem } from "../support/memoryFileSystem";
import { FakeChatModel } from "../support/researchFakes";

const SETTINGS: SavedChatSettings = {
  chatModelProfileId: "profile",
  searchMode: "indexOnly",
  researchMode: "deep-research",
};

function reopen(fileSystem: MemoryFileSystem, model: FakeChatModel, errors: unknown[] = []) {
  const repository = new FileChatRepository({ fileSystem, folder: "chats" });
  const { manager } = createTestSessionManager({
    repository,
    createResearchService: () => deepResearchService(model),
    logError: (error) => errors.push(error),
  });
  return { repository, manager };
}

describe("deep research turns through the chat runtime", () => {
  it("starts a research, keeps its pending plan across a reload and approves it", async () => {
    const fileSystem = new MemoryFileSystem();
    const model = new FakeChatModel([
      { content: planReply(), isComplete: false },
      { content: "", isComplete: true },
    ]);
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
    await second.manager.start(
      adopted.sessionId,
      researchTurn("Approve", {
        type: "decision",
        decision: {
          researchId: active.researchId,
          decisionId: active.pending!.decisionId,
          expectedRevision: active.revision,
          payload: { action: "approve" },
        },
      }),
    );
    await eventually(() => expect(adopted.status).toBe("completed"));

    const approved = await reopen(fileSystem, model).repository.loadChat(session.chatId!);
    const finalSection =
      approved?.deepResearch?.status === "ready" ? approved.deepResearch.section : null;
    expect(finalSection?.active).toMatchObject({ phase: "gathering", pending: null });
    expect(finalSection?.active?.plan?.approvedAt).not.toBeNull();
    expect(approved?.messages.at(-1)?.research?.researchId).toBe(active.researchId);
    expect(model.requests).toHaveLength(1);
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
});
