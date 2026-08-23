import { FileChatRepository as FileChatStore } from "@adapters/filesystem/FileChatRepository";
import { inferChatTitle } from "@core/chat/savedChat";

import { MemoryFileSystem } from "../helpers/memoryFileSystem";

const CHAT_SETTINGS = {
  chatModelProfileId: "chat-model",
  indexProfileId: "index-default",
  searchMode: "indexOnly" as const,
  contextMode: "include" as const,
};

describe("FileChatStore", () => {
  const folder = ".attest/chats";
  let fileSystem: MemoryFileSystem;

  beforeEach(() => {
    fileSystem = new MemoryFileSystem();
  });

  it("persists the none search mode", async () => {
    const store = new FileChatStore({ fileSystem, folder, createId: () => "chat-none" });

    await store.saveChat({
      messages: [],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: {
        chatModelProfileId: "chat-model",
        searchMode: "none",
        researchMode: "thinking",
      },
    });

    expect((await store.loadChat("chat-none"))?.chatSettings?.searchMode).toBe("none");
    expect((await store.loadChat("chat-none"))?.chatSettings?.researchMode).toBe("thinking");
  });

  it("saves a chat and lists summaries by most recent update", async () => {
    let now = new Date("2026-06-10T10:00:00.000Z");
    const store = new FileChatStore({
      fileSystem,
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
      chatSettings: {
        chatModelProfileId: "chat-granite",
        indexProfileId: "index-research",
        searchMode: "indexAndWeb",
        contextMode: "filter",
      },
    });

    expect(saved).toMatchObject({
      id: "chat-fixed",
      title: "How do local chats persist?",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
      attachedContextPaths: ["Docs/source.pdf"],
      chatSettings: {
        chatModelProfileId: "chat-granite",
        indexProfileId: "index-research",
        searchMode: "indexAndWeb",
        contextMode: "filter",
      },
    });

    now = new Date("2026-06-10T10:05:00.000Z");
    await store.saveChat({
      id: "older",
      messages: [{ role: "user", content: "Older chat", createdAt: now.toISOString() }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: CHAT_SETTINGS,
    });

    const summaries = await store.listChats();

    expect(summaries).toEqual([
      {
        id: "older",
        title: "Older chat",
        updatedAt: "2026-06-10T10:05:00.000Z",
        messageCount: 1,
        isFavorite: false,
      },
      {
        id: "chat-fixed",
        title: "How do local chats persist?",
        updatedAt: "2026-06-10T10:00:00.000Z",
        messageCount: 1,
        isFavorite: false,
      },
    ]);
  });

  it("updates an existing chat while preserving createdAt", async () => {
    let now = new Date("2026-06-10T10:00:00.000Z");
    const store = new FileChatStore({
      fileSystem,
      folder,
      now: () => now,
      createId: () => "chat-fixed",
    });

    const first = await store.saveChat({
      messages: [{ role: "user", content: "First title", createdAt: now.toISOString() }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: CHAT_SETTINGS,
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
      chatSettings: CHAT_SETTINGS,
    });

    expect(second.createdAt).toBe("2026-06-10T10:00:00.000Z");
    expect(second.updatedAt).toBe("2026-06-10T10:15:00.000Z");
    expect(second.messages).toHaveLength(2);
    expect(await store.loadChat(first.id)).toEqual(second);
  });

  it("persists favorite state without changing the saved chat history", async () => {
    const store = new FileChatStore({ fileSystem, folder, createId: () => "favorite-chat" });
    await store.saveChat({
      messages: [{ role: "user", content: "Keep this history", createdAt: "2026-06-10T10:00:00Z" }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: CHAT_SETTINGS,
    });

    await store.setChatFavorite("favorite-chat", true);

    expect(await store.listChats()).toEqual([
      expect.objectContaining({ id: "favorite-chat", isFavorite: true }),
    ]);
    expect(await store.loadChat("favorite-chat")).toMatchObject({
      isFavorite: true,
      messages: [{ role: "user", content: "Keep this history" }],
    });

    await store.setChatFavorite("favorite-chat", false);

    expect(await store.loadChat("favorite-chat")).toMatchObject({
      isFavorite: false,
      messages: [{ role: "user", content: "Keep this history" }],
    });
  });

  it("serializes favorite updates with concurrent saves from another repository instance", async () => {
    const firstStore = new FileChatStore({ fileSystem, folder, createId: () => "shared-chat" });
    const secondStore = new FileChatStore({ fileSystem, folder });
    await firstStore.saveChat({
      messages: [{ role: "user", content: "Original message", createdAt: "2026-06-10T10:00:00Z" }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: CHAT_SETTINGS,
    });

    await Promise.all([
      firstStore.saveChat({
        id: "shared-chat",
        messages: [
          { role: "user", content: "Original message", createdAt: "2026-06-10T10:00:00Z" },
          { role: "assistant", content: "Saved answer", createdAt: "2026-06-10T10:01:00Z" },
        ],
        lastAnswer: null,
        attachedContextPaths: [],
        chatSettings: CHAT_SETTINGS,
      }),
      secondStore.setChatFavorite("shared-chat", true),
    ]);

    expect(await firstStore.loadChat("shared-chat")).toMatchObject({
      isFavorite: true,
      messages: [
        { role: "user", content: "Original message" },
        { role: "assistant", content: "Saved answer" },
      ],
    });
  });

  it("persists segmented reasoning separately from the assistant answer", async () => {
    const store = new FileChatStore({ fileSystem, folder, createId: () => "reasoning" });

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
      chatSettings: CHAT_SETTINGS,
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
      fileSystem,
      folder,
      now: () => new Date("2026-06-10T10:00:00.000Z"),
      createId: () => "atomic",
    });

    await store.saveChat({
      messages: [{ role: "user", content: "Atomic write", createdAt: "2026-06-10T10:00:00.000Z" }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: CHAT_SETTINGS,
    });

    await expect(fileSystem.exists(`${folder}/atomic.json.tmp`)).resolves.toBe(false);
    const raw = await fileSystem.readText(`${folder}/atomic.json`);
    expect(JSON.parse(raw)).toMatchObject({
      id: "atomic",
      schemaVersion: 3,
      sourceRegistry: { sources: [] },
    });
  });

  it("saves compact summary markers while counting only visible messages", async () => {
    const store = new FileChatStore({
      fileSystem,
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
      chatSettings: CHAT_SETTINGS,
    });

    const [summary] = await store.listChats();
    const loaded = await store.loadChat("compacted");

    expect(summary.messageCount).toBe(1);
    expect(loaded?.messages[0]).toMatchObject({
      kind: "compact-summary",
      compactSummary: { citedSourcesAlreadyUsed: ["Notes/Plan.md"] },
    });
  });

  it("ignores chats without saved chat settings", async () => {
    const store = new FileChatStore({ fileSystem, folder });
    await fileSystem.writeText(
      `${folder}/missing-settings.json`,
      JSON.stringify({
        schemaVersion: 2,
        id: "missing-settings",
        title: "Missing settings",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z",
        messages: [
          { role: "user", content: "Current chat?", createdAt: "2026-06-10T10:00:00.000Z" },
        ],
        lastAnswer: null,
        attachedContextPaths: [],
      }),
    );

    await expect(store.loadChat("missing-settings")).resolves.toBeNull();
  });

  it("treats legacy saved chats without favorite state as not favorited", async () => {
    const store = new FileChatStore({ fileSystem, folder });
    await fileSystem.writeText(
      `${folder}/legacy.json`,
      JSON.stringify({
        schemaVersion: 2,
        id: "legacy",
        title: "Legacy chat",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z",
        messages: [],
        lastAnswer: null,
        attachedContextPaths: [],
        chatSettings: CHAT_SETTINGS,
      }),
    );

    expect(await store.loadChat("legacy")).toMatchObject({ id: "legacy" });
    expect(await store.listChats()).toEqual([
      expect.objectContaining({ id: "legacy", isFavorite: false }),
    ]);
  });

  it("loads a v2 chat into the v3 registry shape without losing its messages", async () => {
    const store = new FileChatStore({ fileSystem, folder });
    await fileSystem.writeText(
      `${folder}/v2.json`,
      JSON.stringify({
        schemaVersion: 2,
        id: "v2",
        title: "Old chat",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z",
        messages: [
          { role: "user", content: "Old question", createdAt: "2026-06-10T10:00:00.000Z" },
        ],
        lastAnswer: null,
        attachedContextPaths: [],
        chatSettings: CHAT_SETTINGS,
      }),
    );

    await expect(store.loadChat("v2")).resolves.toMatchObject({
      schemaVersion: 3,
      messages: [{ content: "Old question" }],
      sourceRegistry: { sources: [] },
    });
  });

  it("rejects a v3 chat whose persisted registry has malformed revision data", async () => {
    const store = new FileChatStore({ fileSystem, folder });
    await fileSystem.writeText(
      `${folder}/bad-registry.json`,
      JSON.stringify({
        schemaVersion: 3,
        id: "bad-registry",
        title: "Bad registry",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z",
        messages: [],
        lastAnswer: null,
        attachedContextPaths: [],
        chatSettings: CHAT_SETTINGS,
        sourceRegistry: {
          sources: [
            {
              id: "source-1",
              title: "Broken",
              identity: { kind: "web", canonicalKey: "https://example.com" },
              revisions: [
                {
                  id: "source-1:revision-1",
                  contentHash: "hash",
                  capturedAt: "2026-06-10T10:00:00.000Z",
                  status: "active",
                  chunks: [{ id: "broken" }],
                  usages: [{ messageId: "", citationOffsets: [-1] }],
                },
              ],
            },
          ],
        },
      }),
    );

    await expect(store.loadChat("bad-registry")).resolves.toBeNull();
  });

  it("rejects a registry revision whose chunk belongs to a different canonical source", async () => {
    const store = new FileChatStore({ fileSystem, folder });
    await fileSystem.writeText(
      `${folder}/mismatched-registry.json`,
      JSON.stringify({
        schemaVersion: 3,
        id: "mismatched-registry",
        title: "Mismatched registry",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z",
        messages: [],
        lastAnswer: null,
        attachedContextPaths: [],
        chatSettings: CHAT_SETTINGS,
        sourceRegistry: {
          sources: [
            {
              id: "source-1",
              title: "Expected",
              identity: { kind: "web", canonicalKey: "https://example.com/expected" },
              revisions: [
                {
                  id: "source-1:revision-1",
                  contentHash: "hash",
                  capturedAt: "2026-06-10T10:00:00.000Z",
                  status: "active",
                  usages: [],
                  chunks: [
                    {
                      id: "chunk-1",
                      text: "Evidence",
                      contentHash: "hash",
                      score: 1,
                      source: {
                        id: "web-1",
                        kind: "web",
                        title: "Other",
                        url: "https://example.com/other",
                        snippet: "",
                        retrievedAt: "2026-06-10T10:00:00.000Z",
                        wasContentFetched: true,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
    );

    await expect(store.loadChat("mismatched-registry")).resolves.toBeNull();
  });

  it("rejects unsafe chat ids", async () => {
    const store = new FileChatStore({ fileSystem, folder });

    await expect(store.loadChat("../settings")).rejects.toThrow("Unsafe chat id");
    await expect(
      store.saveChat({
        id: "../settings",
        messages: [],
        lastAnswer: null,
        attachedContextPaths: [],
        chatSettings: CHAT_SETTINGS,
      }),
    ).rejects.toThrow("Unsafe chat id");
  });

  it("skips malformed files and makes delete plus missing mutations idempotent", async () => {
    const store = new FileChatStore({ fileSystem, folder });
    await fileSystem.writeText(`${folder}/broken.json`, "{not json");
    await fileSystem.writeText(
      `${folder}/not-a-chat.json`,
      JSON.stringify({ title: "wrong shape" }),
    );
    await fileSystem.writeText(`${folder}/notes.txt`, "not a chat");

    await expect(store.listChats()).resolves.toEqual([]);
    await expect(store.renameChat("missing", "Renamed")).resolves.toBeNull();
    await expect(store.setChatFavorite("missing", true)).resolves.toBeNull();
    await expect(store.deleteChat("missing")).resolves.toBeUndefined();
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
