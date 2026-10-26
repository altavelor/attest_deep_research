import { describe, expect, it } from "vitest";

import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import { ChatDocumentSubAgentRepository } from "@adapters/filesystem/sub-agent/ChatDocumentSubAgentRepository";
import { ChatStorageError, type ChatFileBaseline } from "@application/ports";
import { ChatWriteBuffer } from "@application/use-cases/chat";
import type { SubAgentStateSnapshot } from "@core/research";
import {
  chatInput,
  ManualClock,
  sessionDelta,
  strictVault,
  subAgentSection,
} from "../support/chatDocuments";
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

function buffer(
  repository: FileChatRepository,
  clock: ManualClock,
  base: ChatFileBaseline | null,
  chatId: string | null = "chat-1",
  section: SubAgentStateSnapshot | null = chatId ? subAgentSection() : null,
) {
  const bound: string[] = [];
  const errors: Error[] = [];
  let id = chatId;
  const writer = new ChatWriteBuffer({
    repository,
    getChatId: () => id,
    onChatBound: (next) => {
      id = next;
      bound.push(next);
    },
    base: section,
    baseline: base,
    now: clock.now,
    scheduleTimeout: clock.scheduleTimeout,
    onStorageError: (error) => errors.push(error),
  });
  return { writer, bound, errors };
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

  it("deletes every copy, refuses late writes and resumes the buffer after a failed delete", async () => {
    const { adapter, fileSystem, repository } = setup();
    const base = await seed(repository);
    const clock = new ManualClock();
    const { writer } = buffer(repository, clock, base);
    for (const suffix of [".tmp", ".prev", ".attest-replaced"]) {
      await adapter.write(`${MAIN}${suffix}`, "{}");
    }

    adapter.failNext("remove", "chat-1.json");
    await writer.discard();
    await expect(repository.deleteChat("chat-1")).rejects.toThrow("Interrupted remove");
    writer.reopen();
    await writer.flushThrough(writer.markChatDirty(chatInput({ title: "Kept" })), "barrier");
    expect(JSON.parse(await fileSystem.readText(MAIN)).title).toBe("Kept");

    await writer.discard();
    await repository.deleteChat("chat-1");
    expect(() => writer.markChatDirty(chatInput())).toThrow(ChatStorageError);
    await expect(
      repository.commitChatDocument({ chatId: "chat-1", base, chat: chatInput() }),
    ).rejects.toMatchObject({ code: "chat-missing" });
    expect(await fileSystem.exists(MAIN)).toBe(false);
    expect((await adapter.list(FOLDER)).files).toEqual([]);
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
    await repository.saveChat(chatInput({ title: "After", createdAt: undefined }));
    expect(JSON.parse(await fileSystem.readText(MAIN))).toMatchObject({
      title: "After",
      createdAt: JSON.parse(good).createdAt,
      subAgents: JSON.parse(good).subAgents,
    });
    await adapter.write(MAIN, "{");
    await adapter.write(`${MAIN}.tmp`, good);
    expect((await repository.renameChat("chat-1", "Renamed"))?.title).toBe("Renamed");

    await adapter.write(MAIN, "{");
    await adapter.write(`${MAIN}.tmp`, "{");
    await adapter.write(`${MAIN}.prev`, good);
    expect((await repository.loadChat("chat-1"))?.recoveredFrom).toBe("previous");
    expect(await repository.setChatFavorite("chat-1", true)).toBeNull();
    expect((await repository.listChats()).map((chat) => chat.id)).toEqual(["chat-1"]);

    await adapter.remove(MAIN);
    await adapter.write(`${MAIN}.tmp`, good);
    expect(await repository.loadChat("chat-1")).toBeNull();
    expect(await repository.listChats()).toEqual([]);
  });

  it("detects external writers by content and resolves the conflict", async () => {
    const { fileSystem, repository } = setup();
    const base = await seed(repository);
    const clock = new ManualClock();
    const { writer } = buffer(repository, clock, base);
    const legacy = JSON.parse(await fileSystem.readText(MAIN));
    delete legacy.subAgents;
    await fileSystem.writeText(MAIN, JSON.stringify(legacy, null, 2));
    const legacyBase = (await repository.loadChatDocument("chat-1"))!.base;
    await repository.commitChatDocument({
      chatId: "chat-1",
      base: legacyBase,
      chat: chatInput(),
      subAgents: subAgentSection(),
    });
    const other = new FileChatRepository({ fileSystem, folder: FOLDER });
    const external = (await other.loadChatDocument("chat-1"))!;
    await other.commitChatDocument({
      chatId: "chat-1",
      base: external.base,
      chat: chatInput({ messages: [] }),
    });

    await repository.setChatFavorite("chat-1", true);
    await expect(
      writer.flushThrough(writer.markChatDirty(chatInput({ title: "Mine" })), "barrier"),
    ).rejects.toMatchObject({ code: "document-conflict" });
    await expect(
      repository.commitChatDocument({ chatId: "chat-1", chat: chatInput() }),
    ).rejects.toThrow("needs a baseline");

    writer.markDirty("s", 9, sessionDelta("session-1"));
    await expect(writer.flushThrough(9, "barrier")).rejects.toMatchObject({
      code: "document-conflict",
    });
    await clock.advance(10_000);
    expect(JSON.parse(await fileSystem.readText(MAIN)).messages).toEqual([]);

    await writer.resolveConflict("reload");
    expect((await repository.loadChat("chat-1"))?.isFavorite).toBe(true);
    await writer.flushThrough(writer.markChatDirty(chatInput({ title: "Mine" })), "barrier");
    expect(JSON.parse(await fileSystem.readText(MAIN))).toMatchObject({
      title: "Mine",
      isFavorite: true,
    });

    const stale = (await repository.loadChatDocument("chat-1"))!.base;
    const edited = (await fileSystem.readText(MAIN)).replace(
      '"content":"Question?"',
      '"content":"Questiom?"',
    );
    await fileSystem.writeText(MAIN, edited);
    const subOnly = await repository.commitChatDocument({
      chatId: "chat-1",
      base: stale,
      subAgents: subAgentSection(undefined, { revision: 20 }),
    });
    const keeper = buffer(repository, clock, subOnly.base, "chat-1", null).writer;
    const kept = keeper.markChatDirty(chatInput({ title: "Kept" }));
    await expect(keeper.flushThrough(kept, "barrier")).rejects.toMatchObject({
      code: "document-conflict",
      message: "The chat file was changed outside this window; reload it or keep this chat.",
    });
    await keeper.resolveConflict("keep");
    await keeper.flushThrough(kept, "barrier");
    expect(JSON.parse(await fileSystem.readText(MAIN))).toMatchObject({
      title: "Kept",
      messages: [{ content: "Question?" }],
    });

    const timelineBase = (await repository.loadChatDocument("chat-1"))!.base;
    const writer2 = new FileChatRepository({ fileSystem, folder: FOLDER });
    await writer2.commitChatDocument({
      chatId: "chat-1",
      base: timelineBase,
      chat: chatInput({ title: "Kept", timelineSequence: 7 }),
    });
    await expect(
      repository.commitChatDocument({
        chatId: "chat-1",
        base: timelineBase,
        chat: chatInput({ title: "Late" }),
      }),
    ).rejects.toMatchObject({ code: "document-conflict" });
  });

  it("keeps the previous generation only for terminal chat saves", async () => {
    const { adapter, fileSystem, repository } = setup();
    const base = await seed(repository);
    const afterSection = await repository.commitChatDocument({
      chatId: "chat-1",
      base,
      subAgents: subAgentSection(undefined, { revision: 2 }),
    });
    expect(await fileSystem.exists(`${MAIN}.prev`)).toBe(false);
    const previous = await fileSystem.readText(MAIN);
    const terminal = {
      chatId: "chat-1",
      base: afterSection.base,
      chat: chatInput({ lastRun: COMPLETED }),
    };

    adapter.failNext("rename", "chat-1.json.prev");
    await expect(repository.commitChatDocument(terminal)).rejects.toThrow("Interrupted rename");
    expect(await fileSystem.exists(`${MAIN}.prev`)).toBe(false);
    await repository.commitChatDocument(terminal);

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
    const staleText = await fileSystem.readText(MAIN);
    await fileSystem.writeText(`${FOLDER}/chat-3.json`, "{");
    await fileSystem.writeText(
      `${FOLDER}/chat-3.json.prev`,
      JSON.stringify({ ...JSON.parse(staleText), id: "chat-3", subAgents: undefined }),
    );
    await repository.saveChat(
      chatInput({
        id: "chat-2",
        updatedAt: "2026-10-27T10:00:00.000Z",
        lastRun: { runId: "q", startedAt: COMPLETED.startedAt, status: "running" },
      }),
    );
    await repository.saveChat(
      chatInput({
        id: "chat-4",
        updatedAt: "2026-10-28T10:00:00.000Z",
        lastRun: { runId: "m", startedAt: COMPLETED.startedAt, status: "running" },
      }),
    );
    await repository.commitChatDocument({
      chatId: "chat-4",
      base: (await repository.loadChatDocument("chat-4"))!.base,
      subAgents: subAgentSection(undefined, {
        chatId: "chat-4",
        revision: Number.MAX_SAFE_INTEGER,
      }),
    });
    const vanishing = Object.create(repository) as FileChatRepository;
    vanishing.loadChatDocument = async (id) => {
      const document = await repository.loadChatDocument(id);
      if (id === "chat-2") await repository.deleteChat(id);
      return document;
    };
    const { manager } = createTestSessionManager({ repository: vanishing });

    await manager.normalizeStaleChats();

    expect(await fileSystem.readText(`${FOLDER}/chat-3.json`)).toBe("{");
    expect(await fileSystem.exists(`${FOLDER}/chat-2.json`)).toBe(false);
    const saved = JSON.parse(await fileSystem.readText(MAIN));
    expect(saved.lastRun.status).toBe("interrupted");
    expect(saved.subAgents.records[0].runs[0]).toMatchObject({
      status: "interrupted",
      terminalReason: "crash-recovery",
    });
    expect(saved.subAgentNotices).toEqual([
      expect.objectContaining({
        kind: "interrupted",
        runId: "run-1",
        reasonCode: "crash-recovery",
      }),
    ]);
    expect(saved.subAgentNotices[0].sequence).toBeLessThan(saved.timelineSequence);
  });

  it("creates a new chat through the buffer before control returns and never retries a failed create", async () => {
    const { adapter, fileSystem, repository } = setup();
    const clock = new ManualClock();
    const { writer, bound } = buffer(repository, clock, null, null);
    const running = { runId: "r", startedAt: COMPLETED.startedAt, status: "running" as const };

    await writer.flushThrough(
      writer.markChatDirty(chatInput({ id: undefined, lastRun: running })),
      "barrier",
    );

    expect(bound).toEqual(["chat-1"]);
    expect(JSON.parse(await fileSystem.readText(MAIN))).toMatchObject({
      messages: [{ content: "Question?" }],
      lastRun: { status: "running" },
    });

    await adapter.remove(MAIN);
    const failing = buffer(repository, clock, null, null);
    adapter.failNext("rename", "chat-1.json");
    await expect(
      failing.writer.flushThrough(
        failing.writer.markChatDirty(chatInput({ id: undefined })),
        "barrier",
      ),
    ).rejects.toThrow("Interrupted rename");
    await clock.advance(60_000);
    expect(failing.bound).toEqual([]);
    expect(await fileSystem.exists(MAIN)).toBe(false);
  });

  it("writes chat and sub-agent deltas together and never overwrites an unreadable section", async () => {
    const { adapter, fileSystem, repository } = setup();
    const base = await seed(repository);
    const clock = new ManualClock();
    const { writer } = buffer(repository, clock, base);
    writer.markDirty("session-1", 5, sessionDelta("session-1"));

    await writer.flushThrough(writer.markChatDirty(chatInput({ title: "Both" })), "barrier");
    const saved = JSON.parse(await fileSystem.readText(MAIN));
    expect([
      saved.title,
      saved.subAgents.revision,
      saved.subAgents.records[0].session.title,
    ]).toEqual(["Both", 5, "Renamed"]);

    const current = (await repository.loadChatDocument("chat-1"))!.base;
    await expect(
      repository.commitChatDocument({
        chatId: "chat-1",
        base: current,
        subAgents: subAgentSection(undefined, { revision: 3 }),
      }),
    ).rejects.toMatchObject({
      code: "document-conflict",
      message: "A newer sub-agent state is already saved for this chat.",
    });
    await repository.commitChatDocument({
      chatId: "chat-1",
      base: current,
      subAgents: subAgentSection(undefined, { revision: 5 }),
    });

    await adapter.write(
      MAIN,
      (await fileSystem.readText(MAIN)).replace('"version":1', '"version":7'),
    );
    const reloaded = (await repository.loadChatDocument("chat-1"))!;
    const { writer: second, errors } = buffer(repository, clock, reloaded.base);
    second.markDirty("session-1", 8, sessionDelta("session-1", { title: "Lost" }));
    const chatRevision = second.markChatDirty(chatInput({ title: "Chat only" }));
    await expect(second.flushThrough(chatRevision, "barrier")).rejects.toMatchObject({
      code: "unreadable-section",
    });

    const raw = JSON.parse(await fileSystem.readText(MAIN));
    expect([raw.title, raw.subAgents.version]).toEqual(["Chat only", 7]);
    expect(errors[0]).toMatchObject({
      code: "unreadable-section",
      message: "The saved sub-agent state of this chat is unreadable and was left unchanged.",
    });
  });
});
