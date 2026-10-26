import { describe, expect, it } from "vitest";

import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import { ChatDocumentSubAgentRepository } from "@adapters/filesystem/sub-agent/ChatDocumentSubAgentRepository";
import type { ChatFileBaseline } from "@application/ports";
import type { SubAgentStateSnapshot } from "@core/research";
import { chatInput, strictVault, subAgentSection } from "../support/chatDocuments";
import { createTestSessionManager } from "../support/chatSessions";
import { applyAll, readySubAgentRecord, runToImport } from "../support/subAgentSessions";

const FOLDER = "chats";
const MAIN = `${FOLDER}/chat-1.json`;
const COMPLETED = {
  runId: "run-1",
  startedAt: "2026-10-26T10:00:00.000Z",
  completedAt: "2026-10-26T10:01:00.000Z",
  status: "completed" as const,
};

function setup() {
  const vault = strictVault();
  const repository = new FileChatRepository({
    fileSystem: vault.fileSystem,
    folder: FOLDER,
    now: () => new Date("2026-10-26T10:00:00.000Z"),
    createId: () => "chat-1",
  });
  return { ...vault, repository };
}

async function seed(
  repository: FileChatRepository,
  section: SubAgentStateSnapshot = subAgentSection(),
): Promise<ChatFileBaseline> {
  const created = await repository.commitChatDocument({ chatId: null, chat: chatInput() });
  return (
    await repository.commitChatDocument({
      chatId: "chat-1",
      base: created.base,
      subAgents: section,
    })
  ).base;
}

function sectionText(raw: string): string {
  return JSON.stringify((JSON.parse(raw) as { subAgents: unknown }).subAgents);
}

describe("chat document repository over a vault that refuses replacing renames", () => {
  it("replaces atomically, survives an interrupted replace and keeps the section on every chat write", async () => {
    const { adapter, fileSystem, repository } = setup();
    const base = await seed(repository);
    const before = await fileSystem.readText(MAIN);

    adapter.failNext("rename", "chat-1.json");
    await expect(
      repository.commitChatDocument({ chatId: "chat-1", base, chat: chatInput({ title: "New" }) }),
    ).rejects.toThrow("Interrupted rename");
    expect(await fileSystem.readText(MAIN)).toBe(before);
    expect(await fileSystem.exists(`${MAIN}.tmp`)).toBe(false);

    await repository.commitChatDocument({
      chatId: "chat-1",
      base,
      chat: chatInput({ title: "New" }),
    });
    await repository.saveChat(chatInput({ title: "Saved" }));
    await repository.renameChat("chat-1", "Renamed");
    await repository.setChatFavorite("chat-1", true);
    await repository.setChatUnreadCompletion("chat-1", true);
    await repository.setChatRunState("chat-1", COMPLETED);

    const raw = await fileSystem.readText(MAIN);
    expect(sectionText(raw)).toBe(sectionText(before));
    expect(JSON.parse(raw)).toMatchObject({
      title: "Renamed",
      isFavorite: true,
      unreadCompletion: true,
    });
    expect(await new ChatDocumentSubAgentRepository(repository).load("chat-1")).toEqual(
      subAgentSection(),
    );
  });

  it("recovers orphaned temp files and falls back to the previous generation", async () => {
    const { adapter, fileSystem, repository } = setup();
    await seed(repository);
    const good = await fileSystem.readText(MAIN);

    await adapter.write(`${MAIN}.tmp`, "{");
    expect((await repository.loadChat("chat-1"))?.recoveredFrom).toBeUndefined();
    expect(await fileSystem.exists(`${MAIN}.tmp`)).toBe(false);

    await adapter.write(MAIN, "{");
    await adapter.write(`${MAIN}.tmp`, good);
    expect((await repository.loadChat("chat-1"))?.title).toBe("Question?");
    expect(await fileSystem.readText(MAIN)).toBe(good);

    await adapter.write(MAIN, "{");
    await adapter.write(`${MAIN}.tmp`, "{");
    await adapter.write(`${MAIN}.prev`, good);
    expect((await repository.loadChat("chat-1"))?.recoveredFrom).toBe("previous");
    expect((await repository.listChats()).map((chat) => chat.id)).toEqual(["chat-1"]);

    await adapter.remove(MAIN);
    await adapter.write(`${MAIN}.tmp`, good);
    expect(await repository.loadChat("chat-1")).toBeNull();
    expect(await repository.listChats()).toEqual([]);
  });

  it("keeps the previous generation only for terminal chat saves", async () => {
    const { fileSystem, repository } = setup();
    const base = await seed(repository);
    const afterSection = await repository.commitChatDocument({
      chatId: "chat-1",
      base,
      subAgents: subAgentSection(undefined, { revision: 2 }),
    });
    expect(await fileSystem.exists(`${MAIN}.prev`)).toBe(false);
    const previous = await fileSystem.readText(MAIN);

    await repository.commitChatDocument({
      chatId: "chat-1",
      base: afterSection.base,
      chat: chatInput({ lastRun: COMPLETED }),
    });

    expect(await fileSystem.readText(`${MAIN}.prev`)).toBe(previous);
  });

  it("recovers a stale chat and its sub-agent section in one startup commit", async () => {
    const { fileSystem, repository } = setup();
    const live = applyAll(readySubAgentRecord(), runToImport("run-1").slice(0, 2));
    const base = await seed(repository, subAgentSection([live]));
    await repository.commitChatDocument({
      chatId: "chat-1",
      base,
      chat: chatInput({
        lastRun: { runId: "p", startedAt: COMPLETED.startedAt, status: "running" },
      }),
    });
    const { manager } = createTestSessionManager({ repository });

    await manager.normalizeStaleChats();

    const saved = JSON.parse(await fileSystem.readText(MAIN));
    expect(saved.lastRun.status).toBe("interrupted");
    expect(saved.subAgents.records[0].runs[0]).toMatchObject({
      status: "interrupted",
      terminalReason: "crash-recovery",
    });
  });
});
