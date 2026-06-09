import {
  DEFAULT_SETTINGS,
  formatListInput,
  getActiveIndexProfile,
  migrateSettings,
  normalizeListInput,
  normalizeUrl,
  normalizeVaultFolder,
  updateActiveIndexProfile,
} from "../../src/settings/settings";

describe("Ixplorer settings", () => {
  it("uses local-first safe defaults", () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.duckDuckGoEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.chatModelProviderBaseUrl).toBe("http://localhost:1234/v1");
    expect(DEFAULT_SETTINGS.embeddingProviderBaseUrl).toBe("http://localhost:11434");
    expect(DEFAULT_SETTINGS.lanceDbFolder).toBe(".ixplorer/index");
    expect(DEFAULT_SETTINGS.activeIndexProfileId).toBe("default");
    expect(getActiveIndexProfile(DEFAULT_SETTINGS)).toMatchObject({
      id: "default",
      indexFolder: ".ixplorer/index",
      shardCount: 32,
      chunkSize: 800,
      chunkOverlap: 120,
      keywordIndex: {
        enabled: true,
        strategy: "source-shard",
        minTokenLength: 3,
      },
    });
    expect(DEFAULT_SETTINGS.showChatIndexControl).toBe(true);
    expect(DEFAULT_SETTINGS.debugMode).toBe(false);
  });

  it("migrates partial saved settings over defaults", () => {
    const settings = migrateSettings({
      chatModelProviderBaseUrl: "http://localhost:1234/v1/",
      chatModel: "qwen3",
      embeddingProviderBaseUrl: "http://localhost:11434/",
      embeddingModel: "nomic-embed-text",
      lanceDbFolder: "/custom-index/",
      includeFolders: ["Research", "Papers"],
      excludeGlobs: ["Archive/**"],
      duckDuckGoEnabled: true,
      showChatIndexControl: false,
      debugMode: true,
    });

    expect(settings).toMatchObject({
      chatModelProviderBaseUrl: "http://localhost:1234/v1",
      chatModel: "qwen3",
      embeddingProviderBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      lanceDbFolder: "custom-index",
      activeIndexProfileId: "default",
      includeFolders: ["Research", "Papers"],
      excludeGlobs: ["Archive/**"],
      duckDuckGoEnabled: true,
      showChatIndexControl: false,
      debugMode: true,
    });
    expect(getActiveIndexProfile(settings)).toMatchObject({
      id: "default",
      indexFolder: "custom-index",
      includeFolders: ["Research", "Papers"],
      excludeGlobs: ["Archive/**"],
      embeddingProviderBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      chunkSize: 800,
      chunkOverlap: 120,
    });
  });

  it("keeps valid saved index profiles and selects the requested active profile", () => {
    const settings = migrateSettings({
      activeIndexProfileId: "papers",
      indexProfiles: [
        {
          id: "notes",
          name: "Notes",
          indexFolder: ".ixplorer/notes",
          includeFolders: ["Notes"],
          excludeGlobs: [".trash/**"],
          embeddingProviderBaseUrl: "http://localhost:11434/",
          embeddingModel: "nomic",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "papers",
          name: "Papers",
          indexFolder: "/.ixplorer/papers/",
          includeFolders: ["Papers"],
          excludeGlobs: ["Papers/Archive/**"],
          embeddingProviderBaseUrl: "http://localhost:1234/v1/",
          embeddingModel: "bge",
          chunkSize: 600,
          chunkOverlap: 100,
        },
      ],
    });

    expect(settings.activeIndexProfileId).toBe("papers");
    expect(settings.indexProfiles).toHaveLength(2);
    expect(getActiveIndexProfile(settings)).toMatchObject({
      id: "papers",
      indexFolder: ".ixplorer/papers",
      includeFolders: ["Papers"],
      excludeGlobs: ["Papers/Archive/**"],
      embeddingProviderBaseUrl: "http://localhost:1234/v1",
      embeddingModel: "bge",
      shardCount: 32,
      chunkSize: 600,
      chunkOverlap: 100,
    });
  });

  it("allows disabled chunk overlap and clamps overlap to chunk size", () => {
    const settings = migrateSettings({
      indexProfiles: [
        {
          id: "notes",
          name: "Notes",
          indexFolder: ".ixplorer/notes",
          includeFolders: ["Notes"],
          excludeGlobs: [],
          embeddingProviderBaseUrl: "http://localhost:11434",
          embeddingModel: "nomic",
          chunkSize: 600,
          chunkOverlap: 0,
        },
      ],
    });

    expect(getActiveIndexProfile(settings)).toMatchObject({
      chunkSize: 600,
      chunkOverlap: 0,
    });

    updateActiveIndexProfile(settings, { chunkSize: 100, chunkOverlap: 200 });

    expect(getActiveIndexProfile(settings)).toMatchObject({
      chunkSize: 100,
      chunkOverlap: 99,
    });
  });

  it("falls back when saved settings are malformed", () => {
    const settings = migrateSettings({
      includeFolders: [],
      excludeGlobs: [1, false],
      duckDuckGoEnabled: "yes",
      debugMode: "yes",
    });

    expect(settings.chatModelProviderBaseUrl).toBe(DEFAULT_SETTINGS.chatModelProviderBaseUrl);
    expect(settings.embeddingProviderBaseUrl).toBe(DEFAULT_SETTINGS.embeddingProviderBaseUrl);
    expect(settings.includeFolders).toEqual(DEFAULT_SETTINGS.includeFolders);
    expect(settings.excludeGlobs).toEqual(DEFAULT_SETTINGS.excludeGlobs);
    expect(settings.duckDuckGoEnabled).toBe(false);
    expect(settings.showChatIndexControl).toBe(true);
    expect(settings.debugMode).toBe(false);
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
