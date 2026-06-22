import { existsSync, mkdtempSync, rmSync } from "fs";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { FileChatStore, inferChatTitle } from "../../src/chat/ChatStore";
import { markdownSource, retrieved } from "../helpers/factories";

describe("FileChatStore", () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "ixplorer-chats-"));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("persists the none search mode", async () => {
    const store = new FileChatStore({ folder, createId: () => "chat-none" });

    await store.saveChat({
      messages: [],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: {
        chatModelProfileId: "chat-model",
        searchMode: "none",
      },
    });

    expect((await store.loadChat("chat-none"))?.chatSettings?.searchMode).toBe("none");
  });

  it("saves a chat and lists summaries by most recent update", async () => {
    let now = new Date("2026-06-10T10:00:00.000Z");
    const store = new FileChatStore({
      folder,
      now: () => now,
      createId: () => "chat-fixed",
    });

    const saved = await store.saveChat({
      messages: [
        { role: "user", content: "How do local chats persist?", createdAt: now.toISOString() },
      ],
      lastAnswer: null,
      attachedContextPaths: ["Docs/source.pdf"],
      expandedCitationContexts: [
        {
          citationKey: "markdown:Docs/source.md::",
          radius: 1,
          chunks: [retrieved("adjacent-1", markdownSource("Docs/source.md"), "Adjacent text")],
        },
      ],
      chatSettings: {
        chatModelProfileId: "chat-granite",
        indexProfileId: "index-research",
        searchMode: "indexAndWeb",
        contextMode: "filter",
        deepResearch: true,
      },
    });

    expect(saved).toMatchObject({
      id: "chat-fixed",
      title: "How do local chats persist?",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
      attachedContextPaths: ["Docs/source.pdf"],
      expandedCitationContexts: [
        expect.objectContaining({
          citationKey: "markdown:Docs/source.md::",
          radius: 1,
          chunks: [expect.objectContaining({ id: "adjacent-1" })],
        }),
      ],
      chatSettings: {
        chatModelProfileId: "chat-granite",
        indexProfileId: "index-research",
        searchMode: "indexAndWeb",
        contextMode: "filter",
        deepResearch: true,
      },
    });

    now = new Date("2026-06-10T10:05:00.000Z");
    await store.saveChat({
      id: "older",
      messages: [{ role: "user", content: "Older chat", createdAt: now.toISOString() }],
      lastAnswer: null,
      attachedContextPaths: [],
    });

    const summaries = await store.listChats();

    expect(summaries).toEqual([
      {
        id: "older",
        title: "Older chat",
        updatedAt: "2026-06-10T10:05:00.000Z",
        messageCount: 1,
      },
      {
        id: "chat-fixed",
        title: "How do local chats persist?",
        updatedAt: "2026-06-10T10:00:00.000Z",
        messageCount: 1,
      },
    ]);
  });

  it("updates an existing chat while preserving createdAt", async () => {
    let now = new Date("2026-06-10T10:00:00.000Z");
    const store = new FileChatStore({
      folder,
      now: () => now,
      createId: () => "chat-fixed",
    });

    const first = await store.saveChat({
      messages: [{ role: "user", content: "First title", createdAt: now.toISOString() }],
      lastAnswer: null,
      attachedContextPaths: [],
    });

    now = new Date("2026-06-10T10:15:00.000Z");
    const second = await store.saveChat({
      id: first.id,
      messages: [
        { role: "user", content: "First title", createdAt: first.createdAt },
        { role: "assistant", content: "Saved answer", createdAt: now.toISOString() },
      ],
      lastAnswer: null,
      attachedContextPaths: ["Manual.md"],
    });

    expect(second.createdAt).toBe("2026-06-10T10:00:00.000Z");
    expect(second.updatedAt).toBe("2026-06-10T10:15:00.000Z");
    expect(second.messages).toHaveLength(2);
    expect(await store.loadChat(first.id)).toEqual(second);
  });

  it("persists segmented reasoning separately from the assistant answer", async () => {
    const store = new FileChatStore({ folder, createId: () => "reasoning" });

    await store.saveChat({
      messages: [
        {
          role: "assistant",
          content: "Final answer",
          createdAt: "2026-06-10T10:00:00.000Z",
          reasoning: [
            { id: "reasoning-0", content: "First summary" },
            { id: "reasoning-1", content: "Second summary" },
          ],
          reasoningOpen: false,
        },
      ],
      lastAnswer: null,
      attachedContextPaths: [],
    });

    expect((await store.loadChat("reasoning"))?.messages[0]).toMatchObject({
      content: "Final answer",
      reasoning: [
        { id: "reasoning-0", content: "First summary" },
        { id: "reasoning-1", content: "Second summary" },
      ],
      reasoningOpen: false,
    });
  });

  it("writes JSON atomically without leaving temporary files", async () => {
    const store = new FileChatStore({
      folder,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
      createId: () => "atomic",
    });

    await store.saveChat({
      messages: [{ role: "user", content: "Atomic write", createdAt: "2026-06-10T10:00:00.000Z" }],
      lastAnswer: null,
      attachedContextPaths: [],
    });

    expect(existsSync(join(folder, "atomic.json.tmp"))).toBe(false);
    const raw = await readFile(join(folder, "atomic.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ id: "atomic", schemaVersion: 2 });
  });

  it("saves compact summary markers while counting only visible messages", async () => {
    const store = new FileChatStore({
      folder,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
      createId: () => "compacted",
    });

    await store.saveChat({
      messages: [
        {
          role: "assistant",
          kind: "compact-summary",
          compacted: true,
          content: "Compacted previous chat summary",
          createdAt: "2026-06-10T10:00:00.000Z",
          compactSummary: {
            userGoals: ["Goal"],
            decisions: ["Decision"],
            unresolvedQuestions: [],
            citedSourcesAlreadyUsed: ["Notes/Plan.md"],
          },
        },
        {
          role: "user",
          content: "Visible question",
          createdAt: "2026-06-10T10:01:00.000Z",
        },
      ],
      lastAnswer: null,
      attachedContextPaths: [],
    });

    const [summary] = await store.listChats();
    const loaded = await store.loadChat("compacted");

    expect(summary.messageCount).toBe(1);
    expect(loaded?.messages[0]).toMatchObject({
      kind: "compact-summary",
      compactSummary: { citedSourcesAlreadyUsed: ["Notes/Plan.md"] },
    });
  });

  it("loads legacy chats without saved chat settings", async () => {
    const store = new FileChatStore({ folder });
    await store.saveChat({
      id: "legacy",
      messages: [{ role: "user", content: "Legacy chat", createdAt: "2026-06-10T10:00:00.000Z" }],
      lastAnswer: null,
      attachedContextPaths: [],
    });

    const loaded = await store.loadChat("legacy");

    expect(loaded).toMatchObject({ id: "legacy" });
    expect(loaded).not.toHaveProperty("chatSettings");
  });

  it("rejects unsafe chat ids", async () => {
    const store = new FileChatStore({ folder });

    await expect(store.loadChat("../settings")).rejects.toThrow("Unsafe chat id");
    await expect(
      store.saveChat({
        id: "../settings",
        messages: [],
        lastAnswer: null,
        attachedContextPaths: [],
      }),
    ).rejects.toThrow("Unsafe chat id");
  });
});

describe("inferChatTitle", () => {
  it("uses the first user message and truncates long titles", () => {
    expect(
      inferChatTitle([
        { role: "assistant", content: "Hello", createdAt: "2026-06-10T10:00:00.000Z" },
        {
          role: "user",
          content: "A very long question ".repeat(8),
          createdAt: "2026-06-10T10:00:00.000Z",
        },
      ]),
    ).toHaveLength(80);
    expect(inferChatTitle([])).toBe("Untitled chat");
  });
});
