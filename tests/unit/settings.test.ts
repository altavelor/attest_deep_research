import {
  DEFAULT_SETTINGS,
  formatListInput,
  getActiveIndexProfile,
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
      isSuspended: true,
      suspendedReason: "Select an embedding model profile.",
    });
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
