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
});
