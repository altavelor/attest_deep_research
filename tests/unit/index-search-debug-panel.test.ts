import { readFileSync } from "fs";
import { resolve } from "path";

import { indexSearchEmbedderWarning } from "@apps/obsidian/composition/profileResolvers";
import { DEFAULT_SETTINGS, cloneIndexProfile } from "@adapters/settings";
import type { EmbeddingModelProfile, IxplorerSettings, ServerProfile } from "@adapters/settings";

function createSettings(overrides: Partial<IxplorerSettings> = {}): IxplorerSettings {
  return {
    ...DEFAULT_SETTINGS,
    indexProfiles: DEFAULT_SETTINGS.indexProfiles.map(cloneIndexProfile),
    embeddingModelProfiles: [],
    ...overrides,
  };
}

function embeddingProfile(overrides: Partial<EmbeddingModelProfile> = {}): EmbeddingModelProfile {
  return {
    id: "embedding",
    name: "Embedding",
    serverProfileId: "server",
    modelName: "embed-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function serverProfile(): ServerProfile {
  return {
    id: "server",
    name: "Server",
    apiFormat: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("index-search debug panel", () => {
  it("blocks search with a safe warning when the selected index has no usable embedder", () => {
    const settings = createSettings({
      embeddingModelProfiles: [],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "missing",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, "index")).toBe(
      "The selected index's embedding model profile is unavailable. Update it in Ixplorer settings.",
    );
  });

  it("blocks search when a capability check found the embedder unsuitable", () => {
    const settings = createSettings({
      serverProfiles: [serverProfile()],
      embeddingModelProfiles: [
        embeddingProfile({
          capabilities: { chat: false, embeddings: false, detectionSource: "probe" },
        }),
      ],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "embedding",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, "index")).toBe(
      "The selected index's embedding model cannot create embeddings. Update it in Ixplorer settings.",
    );
  });

  it("blocks search when the selected embedding profile is suspended", () => {
    const settings = createSettings({
      serverProfiles: [serverProfile()],
      embeddingModelProfiles: [embeddingProfile({ isSuspended: true })],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "embedding",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, "index")).toBe(
      "The selected index's embedding model profile is suspended. Update it in Ixplorer settings.",
    );
  });

  it("allows search when the selected index has an available embedding profile", () => {
    const settings = createSettings({
      serverProfiles: [serverProfile()],
      embeddingModelProfiles: [
        embeddingProfile({
          capabilities: { chat: false, embeddings: true, detectionSource: "probe" },
        }),
      ],
      indexProfiles: [
        {
          ...createSettings().indexProfiles[0],
          id: "index",
          embeddingModelProfileId: "embedding",
          lastIndexedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(indexSearchEmbedderWarning(settings, "index")).toBeUndefined();
  });

  it("keeps the tab and panel behind debug mode and removes indexing controls", () => {
    const header = readFileSync(resolve("src/apps/obsidian/ui/chat/ChatHeader.ts"), "utf8");
    const view = readFileSync(resolve("src/apps/obsidian/ui/chat/IxplorerChatView.ts"), "utf8");
    const controller = readFileSync(
      resolve("src/apps/obsidian/ui/index/IndexSearchController.ts"),
      "utf8",
    );
    const panel = readFileSync(resolve("src/apps/obsidian/ui/index/IndexSearchPanel.ts"), "utf8");

    expect(header).toContain("isDebugMode");
    expect(view).toContain("this.services.isDebugMode()");
    expect(view).toContain('this.activePanel = "chat"');
    expect(controller).not.toContain("renderIndexControl");
    expect(controller).not.toContain("IndexControl");
    expect(panel).not.toContain("indexControlEl");
  });

  it("redisplays open chat views immediately after Debug mode changes", () => {
    const settingsTab = readFileSync(resolve("src/apps/obsidian/ui/SettingsTab.ts"), "utf8");
    const plugin = readFileSync(resolve("src/apps/obsidian/main.ts"), "utf8");
    const view = readFileSync(resolve("src/apps/obsidian/ui/chat/IxplorerChatView.ts"), "utf8");
    const composer = readFileSync(
      resolve("src/apps/obsidian/ui/chat/ChatComposerController.ts"),
      "utf8",
    );

    expect(settingsTab).toContain("this.plugin.refreshChatViews()");
    expect(plugin).toContain("refreshChatViews(): void");
    expect(plugin).toContain("getLeavesOfType(IXPLORER_CHAT_VIEW_TYPE)");
    expect(view).toContain("redisplay(): void");
    expect(view).toContain("this.composer.render(chatPanel);");
    expect(composer).toContain("const draft = this.getQuestionInput();");
    expect(composer).toContain("this.refs.textareaEl.value = draft;");
    expect(composer).toContain("this.setFormRunning(this.options.isRunning());");
  });

  it("preserves keyword fallback results and renders an accessible warning", () => {
    const controller = readFileSync(
      resolve("src/apps/obsidian/ui/index/IndexSearchController.ts"),
      "utf8",
    );
    const panel = readFileSync(resolve("src/apps/obsidian/ui/index/IndexSearchPanel.ts"), "utf8");
    const main = readFileSync(resolve("src/apps/obsidian/main.ts"), "utf8");

    expect(main).toContain("semanticError: result.semanticError");
    expect(controller).toContain("semanticError");
    expect(panel).toContain('role: "alert"');
    expect(controller).toContain("Index search degraded to keyword-only ranking");
  });

  it("clears profile-specific semantic fallback warnings when the selected profile changes", () => {
    const controller = readFileSync(
      resolve("src/apps/obsidian/ui/index/IndexSearchController.ts"),
      "utf8",
    );

    const availabilityUpdater = controller.slice(
      controller.indexOf("private updateSearchAvailability"),
      controller.indexOf("private isSearchBlocked"),
    );

    expect(availabilityUpdater).toContain("this.semanticError = null;");
  });
});
