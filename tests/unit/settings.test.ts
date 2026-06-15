import {
  DEFAULT_SETTINGS,
  MAX_INDEX_PROFILE_COUNT,
  formatListInput,
  getActiveIndexProfile,
  isValidIndexProfileName,
  isIndexProfileSelectable,
  migrateSettings,
  normalizeListInput,
  normalizeSettingsState,
  normalizeUrl,
  normalizeVaultFolder,
  resolveChatModelProfile,
  updateActiveIndexProfile,
} from "../../src/settings/settings";

describe("Ixplorer settings", () => {
  it("uses local-first safe defaults", () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.serverProfiles).toEqual([]);
    expect(DEFAULT_SETTINGS.chatModelProfiles).toEqual([]);
    expect(DEFAULT_SETTINGS.embeddingModelProfiles).toEqual([]);
    expect(DEFAULT_SETTINGS.activeChatModelProfileId).toBe("");
    expect(DEFAULT_SETTINGS.lanceDbFolder).toBe(".ixplorer/index");
    expect(getActiveIndexProfile(DEFAULT_SETTINGS)).toMatchObject({
      id: "default",
      indexFolder: ".ixplorer/index",
      embeddingModelProfileId: "",
      isSuspended: true,
      shardCount: 32,
      mode: "wholeVault",
      chunkSize: 800,
      chunkOverlap: 120,
    });
    expect(DEFAULT_SETTINGS.showChatIndexControl).toBe(true);
    expect(DEFAULT_SETTINGS.debugMode).toBe(false);
  });

  it("keeps new profile settings and selects the active chat model", () => {
    const settings = migrateSettings({
      serverProfiles: [
        {
          id: "server-openrouter",
          name: "OpenRouter",
          apiFormat: "openai-compatible",
          baseUrl: "https://openrouter.ai/api/v1/",
        },
      ],
      chatModelProfiles: [
        {
          id: "chat-a",
          name: "Main chat",
          serverProfileId: "server-openrouter",
          modelName: "openai/gpt-4.1",
          capabilities: {
            chat: true,
            embeddings: false,
            contextLength: 128000,
            detectionSource: "metadata",
          },
        },
      ],
      activeChatModelProfileId: "chat-a",
      duckDuckGoEnabled: true,
      showChatIndexControl: false,
      debugMode: true,
    });

    expect(settings.serverProfiles[0]).toMatchObject({
      id: "server-openrouter",
      name: "OpenRouter",
      apiFormat: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    expect(resolveChatModelProfile(settings, "chat-a")).toMatchObject({
      id: "chat-a",
      isSuspended: false,
      capabilities: expect.objectContaining({ contextLength: 128000 }),
    });
    expect(settings.activeChatModelProfileId).toBe("chat-a");
    expect(settings.duckDuckGoEnabled).toBe(true);
    expect(settings.showChatIndexControl).toBe(false);
    expect(settings.debugMode).toBe(true);
  });

  it("marks dependent profiles suspended when server is missing or suspended", () => {
    const settings = migrateSettings({
      serverProfiles: [
        {
          id: "server-a",
          name: "Server A",
          apiFormat: "openai-compatible",
          baseUrl: "https://example.com/v1",
          isSuspended: true,
        },
      ],
      chatModelProfiles: [
        { id: "chat-a", name: "Chat A", serverProfileId: "server-a", modelName: "model-a" },
        { id: "chat-b", name: "Chat B", serverProfileId: "missing", modelName: "model-b" },
      ],
      activeChatModelProfileId: "chat-a",
    });

    expect(settings.chatModelProfiles).toMatchObject([
      { id: "chat-a", isSuspended: true, suspendedReason: "Server profile is suspended." },
      { id: "chat-b", isSuspended: true, suspendedReason: "Server profile was deleted." },
    ]);
    expect(settings.activeChatModelProfileId).toBe("");
  });

  it("suspends index profiles without a valid embedding model profile", () => {
    const settings = migrateSettings({
      indexProfiles: [
        {
          id: "notes",
          name: "Notes",
          indexFolder: ".ixplorer/notes",
          includeFolders: ["Notes"],
          excludeGlobs: [],
          embeddingModelProfileId: "missing",
        },
      ],
    });

    expect(getActiveIndexProfile(settings)).toMatchObject({
      id: "notes",
      mode: "wholeVault",
      isSuspended: true,
      suspendedReason: "Select an embedding model profile.",
    });
  });

  it("limits saved index profiles to the configured maximum", () => {
    const indexProfiles = Array.from({ length: MAX_INDEX_PROFILE_COUNT + 3 }, (_, index) => ({
      id: `index-${index}`,
      name: `Index ${index}`,
      indexFolder: `.ixplorer/indexes/index-${index}`,
      includeFolders: ["/"],
      excludeGlobs: [],
      embeddingModelProfileId: "embed-a",
    }));

    const settings = migrateSettings({ indexProfiles });

    expect(settings.indexProfiles).toHaveLength(MAX_INDEX_PROFILE_COUNT);
    expect(settings.indexProfiles.at(-1)?.id).toBe(`index-${MAX_INDEX_PROFILE_COUNT - 1}`);
  });

  it("uses the first non-suspended index as default when the current default is unavailable", () => {
    const settings = migrateSettings({
      serverProfiles: [
        {
          id: "server-a",
          name: "Server A",
          apiFormat: "ollama",
          baseUrl: "http://localhost:11434",
        },
      ],
      embeddingModelProfiles: [
        { id: "embed-a", name: "Embed A", serverProfileId: "server-a", modelName: "nomic" },
      ],
      activeIndexProfileId: "broken",
      indexProfiles: [
        {
          id: "broken",
          name: "Broken",
          indexFolder: ".ixplorer/indexes/broken",
          includeFolders: ["/"],
          excludeGlobs: [],
          embeddingModelProfileId: "missing",
        },
        {
          id: "active",
          name: "Active",
          indexFolder: ".ixplorer/indexes/active",
          includeFolders: ["/"],
          excludeGlobs: [],
          embeddingModelProfileId: "embed-a",
        },
      ],
    });

    expect(settings.activeIndexProfileId).toBe("active");
    expect(getActiveIndexProfile(settings).id).toBe("active");
  });

  it("normalizes index profile mode and persisted summary fields", () => {
    const settings = migrateSettings({
      indexProfiles: [
        {
          id: "selected",
          name: "Selected",
          mode: "selected",
          indexFolder: ".ixplorer/indexes/selected",
          includeFolders: ["Notes", "Paper.pdf"],
          excludeGlobs: [],
          embeddingModelProfileId: "",
          lastIndexedAt: "2026-06-14T10:00:00.000Z",
          indexedFileCount: 12,
          indexSizeBytes: 3456,
        },
      ],
    });

    expect(settings.indexProfiles[0]).toMatchObject({
      mode: "selected",
      includeFolders: ["Notes", "Paper.pdf"],
      lastIndexedAt: "2026-06-14T10:00:00.000Z",
      indexedFileCount: 12,
      indexSizeBytes: 3456,
    });
  });

  it("treats only active indexed profiles as selectable", () => {
    expect(
      isIndexProfileSelectable({
        ...DEFAULT_SETTINGS.indexProfiles[0],
        isSuspended: false,
        lastIndexedAt: "2026-06-14T10:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isIndexProfileSelectable({
        ...DEFAULT_SETTINGS.indexProfiles[0],
        isSuspended: false,
        lastIndexedAt: undefined,
      }),
    ).toBe(false);
    expect(
      isIndexProfileSelectable({
        ...DEFAULT_SETTINGS.indexProfiles[0],
        isSuspended: true,
        lastIndexedAt: "2026-06-14T10:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("validates index profile names for UI input", () => {
    expect(isValidIndexProfileName("Research index [A]")).toBe(true);
    expect(isValidIndexProfileName("")).toBe(false);
    expect(isValidIndexProfileName("A".repeat(61))).toBe(false);
    expect(isValidIndexProfileName("Bad/name")).toBe(false);
  });

  it("activates the first non-suspended chat model when active is invalid", () => {
    const settings = migrateSettings({
      serverProfiles: [
        {
          id: "server-a",
          name: "Server A",
          apiFormat: "openai-compatible",
          baseUrl: "https://example.com/v1",
        },
      ],
      chatModelProfiles: [
        { id: "chat-a", name: "Chat A", serverProfileId: "missing", modelName: "model-a" },
        { id: "chat-b", name: "Chat B", serverProfileId: "server-a", modelName: "model-b" },
      ],
      activeChatModelProfileId: "chat-a",
    });

    expect(settings.activeChatModelProfileId).toBe("chat-b");
  });

  it("allows disabled chunk overlap and clamps overlap to chunk size", () => {
    const settings = migrateSettings({});

    updateActiveIndexProfile(settings, { chunkSize: 100, chunkOverlap: 200 });

    expect(getActiveIndexProfile(settings)).toMatchObject({
      chunkSize: 100,
      chunkOverlap: 99,
    });
  });

  it("normalizes state when an embedding model becomes available", () => {
    const settings = migrateSettings({
      serverProfiles: [
        {
          id: "server-a",
          name: "Server A",
          apiFormat: "ollama",
          baseUrl: "http://localhost:11434",
        },
      ],
      embeddingModelProfiles: [
        { id: "embed-a", name: "Embed A", serverProfileId: "server-a", modelName: "nomic" },
      ],
    });

    updateActiveIndexProfile(settings, { embeddingModelProfileId: "embed-a" });
    normalizeSettingsState(settings);

    expect(getActiveIndexProfile(settings)).toMatchObject({
      embeddingModelProfileId: "embed-a",
      isSuspended: false,
    });
  });

  it("normalizes editable list text", () => {
    expect(normalizeListInput("Research\n\n Papers \n")).toEqual(["Research", "Papers"]);
    expect(formatListInput(["Research", "Papers"])).toBe("Research\nPapers");
  });

  it("normalizes urls and vault-local folders", () => {
    expect(normalizeUrl(" http://localhost:1234/v1/ ", "fallback")).toBe(
      "http://localhost:1234/v1",
    );
    expect(normalizeUrl("   ", "fallback")).toBe("fallback");
    expect(normalizeVaultFolder(" /.ixplorer/index/ ")).toBe(".ixplorer/index");
    expect(normalizeVaultFolder("   ")).toBe(DEFAULT_SETTINGS.lanceDbFolder);
  });
});
