import {
  DEFAULT_SETTINGS,
  formatListInput,
  migrateSettings,
  normalizeListInput,
  normalizeUrl,
  normalizeVaultFolder,
} from "../../src/settings/settings";

describe("Ixplorer settings", () => {
  it("uses local-first safe defaults", () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.duckDuckGoEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.chatModelProviderBaseUrl).toBe("http://localhost:1234/v1");
    expect(DEFAULT_SETTINGS.embeddingProviderBaseUrl).toBe("http://localhost:11434");
    expect(DEFAULT_SETTINGS.lanceDbFolder).toBe(".ixplorer/index");
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
    });

    expect(settings).toMatchObject({
      chatModelProviderBaseUrl: "http://localhost:1234/v1",
      chatModel: "qwen3",
      embeddingProviderBaseUrl: "http://localhost:11434",
      embeddingModel: "nomic-embed-text",
      lanceDbFolder: "custom-index",
      includeFolders: ["Research", "Papers"],
      excludeGlobs: ["Archive/**"],
      duckDuckGoEnabled: true,
    });
  });

  it("falls back when saved settings are malformed", () => {
    const settings = migrateSettings({
      includeFolders: [],
      excludeGlobs: [1, false],
      duckDuckGoEnabled: "yes",
    });

    expect(settings.chatModelProviderBaseUrl).toBe(DEFAULT_SETTINGS.chatModelProviderBaseUrl);
    expect(settings.embeddingProviderBaseUrl).toBe(DEFAULT_SETTINGS.embeddingProviderBaseUrl);
    expect(settings.includeFolders).toEqual(DEFAULT_SETTINGS.includeFolders);
    expect(settings.excludeGlobs).toEqual(DEFAULT_SETTINGS.excludeGlobs);
    expect(settings.duckDuckGoEnabled).toBe(false);
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
