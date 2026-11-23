import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import type { SavedChatSettings } from "@core/chat/savedChat";
import type { ChatModelProvider } from "@core/agent";
import { eventually } from "../support/async";
import { createTestSessionManager } from "../support/chatSessions";
import {
  BranchModelRounds,
  PlanAndReportModel,
  StallingPlanModel,
  deepResearchService,
  researchTurn,
} from "../support/deepResearch";
import { MemoryFileSystem } from "../support/memoryFileSystem";
import { FakeRetriever } from "../support/researchFakes";

const SETTINGS: SavedChatSettings = {
  chatModelProfileId: "profile",
  searchMode: "indexOnly",
  researchMode: "deep-research",
};

function open(fileSystem: MemoryFileSystem, model: ChatModelProvider) {
  const repository = new FileChatRepository({ fileSystem, folder: "chats" });
  const { manager } = createTestSessionManager({
    repository,
    createResearchService: () =>
      deepResearchService(model, {
        retriever: new FakeRetriever({ chunks: [], citations: [], usedFallback: false }),
        modelRound: new BranchModelRounds(),
      }),
  });
  return { repository, manager };
}

describe("deep research plan edit in place", () => {
  it("commits an edit as a new plan revision without a chat message or model call", async () => {
    const fileSystem = new MemoryFileSystem();
    const model = new PlanAndReportModel();
    const { manager } = open(fileSystem, model);
    const session = manager.createSession(SETTINGS);
    await manager.start(session.sessionId, researchTurn("How do tides work?"));
    await eventually(() => expect(session.status).toBe("completed"));
    const active =
      session.deepResearch?.status === "ready" ? session.deepResearch.section.active! : null;
    const branchId = active!.plan!.branches[0]!.branchId;
    const messageCount = session.messages.length;
    const modelCalls = model.requests.length;
    const request = {
      researchId: active!.researchId,
      decisionId: active!.pending!.decisionId,
      expectedRevision: active!.revision,
      branches: [{ branchId, enabled: true, task: "Measure the tide table" }],
    };

    expect(await manager.editResearchPlan(session.sessionId, request)).toEqual({ ok: true });
    const stale = await manager.editResearchPlan(session.sessionId, {
      ...request,
      branches: [{ branchId, task: "Stale" }],
    });

    expect(stale).toEqual({ ok: false, message: expect.stringContaining("no longer matches") });
    expect(session.messages).toHaveLength(messageCount);
    expect(model.requests).toHaveLength(modelCalls);
    const saved = await open(fileSystem, model).repository.loadChat(session.chatId!);
    const edited = saved?.deepResearch?.status === "ready" ? saved.deepResearch.section : null;
    expect(edited?.active).toMatchObject({
      revision: active!.revision + 1,
      pending: { kind: "plan" },
      plan: { revision: active!.plan!.revision + 1 },
    });
    expect(edited?.active?.pending?.decisionId).not.toBe(request.decisionId);
    expect(edited?.active?.plan?.branches[0]?.task).toBe("Measure the tide table");
    expect(saved!.messages.at(-1)?.research?.revision).toBe(active!.revision + 1);
  });

  it("refuses an edit while a run of the chat is active", async () => {
    const model = new StallingPlanModel();
    const { manager } = open(new MemoryFileSystem(), model);
    const session = manager.createSession(SETTINGS);
    await manager.start(session.sessionId, researchTurn("First"));
    await eventually(() => expect(model.requests).toHaveLength(1));

    const result = await manager.editResearchPlan(session.sessionId, {
      researchId: "research-1",
      decisionId: "decision-1",
      expectedRevision: 1,
      branches: [],
    });

    expect(result).toEqual({
      ok: false,
      message: "The plan cannot be edited while this chat is running.",
    });
    manager.stop(session.sessionId);
    await eventually(() => expect(session.status).toBe("interrupted"));
  });
});
